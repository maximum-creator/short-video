"""Exercise the local DOCX screenplay import path with generated in-memory files."""

from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
from threading import Thread
from zipfile import ZIP_DEFLATED, ZipFile

from playwright.sync_api import expect, sync_playwright


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def paragraph(text, style=None):
    style_xml = f'<w:pPr><w:pStyle w:val="{style}"/></w:pPr>' if style else ""
    return f"<w:p>{style_xml}<w:r><w:t>{text}</w:t></w:r></w:p>"


def make_docx():
    body = "".join(
        [
            paragraph("Series note before episodes"),
            paragraph("第01集：夜归", "Heading1"),
            paragraph("第1场：夜 / 外 场景", "Heading2"),
            paragraph("角色A走进场景。"),
            paragraph("角色A（低声）：你怎么来了？"),
            paragraph("【沈砚】"),
            paragraph("“我一直在等你。”"),
            paragraph("第02集：门后", "Heading1"),
            paragraph("她停步回头。"),
        ]
    )
    xml = (
        f'<?xml version="1.0" encoding="UTF-8"?>'
        f'<w:document xmlns:w="{WORD_NS}"><w:body>{body}</w:body></w:document>'
    )
    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("word/document.xml", xml)
    return output.getvalue()


def main():
    workspace = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(
        ("127.0.0.1", 0), partial(QuietHandler, directory=str(workspace))
    )
    Thread(target=server.serve_forever, daemon=True).start()
    errors = []
    docx_bytes = make_docx()
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            page = browser.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            project = {
                "series": {"title": "DOCX smoke"},
                "episodes": [
                    {
                        "episodeTitle": "已有集",
                        "pages": {"story": "已有正文", "dialogue": "对白保留"},
                        "targetDurationSec": 90,
                        "shots": [{}],
                    },
                    {
                        "pages": {"story": "", "rules": "设定保留"},
                        "targetDurationSec": 90,
                        "shots": [{}],
                    },
                ],
            }
            page.add_init_script(
                "localStorage.setItem('arc-production-v1', "
                + json.dumps(json.dumps(project))
                + ")"
            )
            page.goto(f"http://127.0.0.1:{server.server_port}/")
            page.locator('[data-view="script"]').click()
            page.locator("[data-script-import-open]").click()
            page.locator("[data-script-import-file]").set_input_files(
                {
                    "name": "screenplay.docx",
                    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "buffer": docx_bytes,
                }
            )
            dialog = page.locator("[data-script-import-dialog]")
            expect(dialog).to_be_visible()
            expect(dialog.locator(".script-import-row")).to_have_count(2)
            expect(dialog.locator("[data-script-import-preface-text]")).to_contain_text(
                "Series note before episodes"
            )
            expect(
                dialog.locator(".script-import-row details pre").nth(0)
            ).to_contain_text("角色A走进场景。")
            expect(dialog.locator(".script-import-row select").nth(0)).to_have_value(
                "keep"
            )
            expect(dialog.locator(".script-import-row select").nth(1)).to_have_value(
                "replace"
            )
            dialog.locator("[data-script-import-include-preface]").uncheck()
            dialog.locator(".script-import-row select").nth(0).select_option("replace")
            dialog.locator("[data-script-import-apply]").click()
            saved = page.evaluate(
                "JSON.parse(localStorage.getItem('arc-production-v1'))"
            )
            assert page.evaluate("""(() => {
              const project = JSON.parse(localStorage.getItem('arc-production-v1'));
              return window.arcProductionProject.restore(window.arcProductionProject.backup(project)).scriptImportHistory.length;
            })()""") == 1
            expect(page.locator("[data-script-import-history]")).to_be_visible()
            expect(page.locator("[data-script-import-history]")).to_contain_text("screenplay.docx")
            assert len(saved["scriptImportHistory"][0]["sha256"]) == 64
            assert page.evaluate("""(() => {
              const project = JSON.parse(localStorage.getItem('arc-production-v1'));
              project.scriptImportHistory[0].sha256 = 'bad';
              try { window.arcProductionProject.restore(window.arcProductionProject.backup(project)); return false; }
              catch { return true; }
            })()""")
            original_story = saved["episodes"][0]["pages"]["story"]
            assert "第1场：夜 / 外 场景" in original_story
            assert saved["episodes"][0]["pages"]["dialogue"] == "对白保留"
            assert saved["episodes"][1]["pages"]["story"] == "她停步回头。"
            assert saved["episodes"][1]["pages"]["rules"] == "设定保留"

            page.locator("#production-episode").select_option("0")
            page.locator("[data-structure-analyze]").click()
            expect(page.locator("[data-structure-counts]")).to_contain_text("1 个场次标题、1 条明确对白、1 条待确认对白")
            expect(page.locator("[data-structure-unclassified]")).to_contain_text("角色A走进场景。")
            page.locator("[data-structure-use-scenes]").check()
            page.locator("[data-structure-use-dialogue]").check()
            page.locator("[data-structure-use-candidates]").check()
            page.locator("[data-structure-apply]").click()
            structured = page.evaluate(
                "JSON.parse(localStorage.getItem('arc-production-v1'))"
            )["episodes"][0]["pages"]
            assert structured["story"] == original_story, "structure copy must preserve the original imported screenplay"
            assert "第1场：夜 / 外 场景" in structured["sceneOutline"]
            assert "角色A走进场景。" not in structured["sceneOutline"], "unclassified lines must not be moved automatically"
            assert "对白保留" in structured["dialogue"]
            assert "角色A（低声）：你怎么来了？" in structured["dialogue"]
            assert "沈砚（待确认）：“我一直在等你。”" in structured["dialogue"]
            page.locator("[data-structure-analyze]").click()
            page.locator("[data-structure-use-scenes]").check()
            page.locator("[data-structure-use-dialogue]").check()
            expect(page.locator("[data-structure-apply]")).to_be_disabled()
            expect(page.locator("[data-structure-status]")).to_contain_text("已存在")
            page.set_viewport_size({"width": 390, "height": 844})
            apply_box = page.locator("[data-structure-apply]").bounding_box()
            assert apply_box and apply_box["x"] >= 0 and apply_box["x"] + apply_box["width"] <= 390

            history = page.evaluate("JSON.parse(localStorage.getItem('arc-production-v1')).scriptImportHistory")
            assert len(history) == 1 and history[0]["fileName"] == "screenplay.docx"
            assert "story" not in json.dumps(history) and "角色A走进场景" not in json.dumps(history)
            page.set_viewport_size({"width": 1280, "height": 850})
            before_repeat = page.evaluate("localStorage.getItem('arc-production-v1')")
            page.locator("[data-script-import-open]").click()
            page.locator("[data-script-import-file]").set_input_files(
                {
                    "name": "screenplay.docx",
                    "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "buffer": docx_bytes,
                }
            )
            repeat_dialog = page.locator("[data-script-import-dialog]")
            expect(repeat_dialog.locator("[data-script-import-repeat]")).to_be_visible()
            expect(repeat_dialog.locator("[data-script-import-repeat-warning]")).to_contain_text("导入过")
            repeat_dialog.locator("[data-script-import-include-preface]").uncheck()
            repeat_dialog.locator(".script-import-row select").nth(1).select_option("append")
            expect(repeat_dialog.locator("[data-script-import-repeat-warning]")).to_contain_text("已包含")
            expect(repeat_dialog.locator("[data-script-import-apply]")).to_be_disabled()
            repeat_dialog.locator("[data-script-import-repeat-confirm]").check()
            expect(repeat_dialog.locator("[data-script-import-apply]")).to_be_enabled()
            repeat_dialog.locator("[data-script-import-apply]").click()
            repeated = page.evaluate("JSON.parse(localStorage.getItem('arc-production-v1'))")
            assert len(repeated["scriptImportHistory"]) == 2
            page.locator(".script-import-undo button").click()
            assert page.evaluate("localStorage.getItem('arc-production-v1')") == before_repeat

            before_bad_file = page.evaluate(
                "localStorage.getItem('arc-production-v1')"
            )
            page.locator("[data-script-import-open]").click()
            with page.expect_event("dialog") as import_error:
                page.locator("[data-script-import-file]").set_input_files(
                    {
                        "name": "damaged.docx",
                        "mimeType": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                        "buffer": b"not a Word archive",
                    }
                )
            assert "docx" in import_error.value.message.lower()
            import_error.value.accept()
            expect(page.locator("[data-script-import-dialog]")).to_be_hidden()
            assert (
                page.evaluate("localStorage.getItem('arc-production-v1')")
                == before_bad_file
            )
            assert not errors, errors
            browser.close()
    finally:
        server.shutdown()
    print("PASS local DOCX headings/paragraphs, episode matching, field preservation, corrupt-file rejection")


if __name__ == "__main__":
    main()
