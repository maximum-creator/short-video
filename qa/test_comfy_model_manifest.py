import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import importlib.util

spec = importlib.util.spec_from_file_location("comfy_model_manifest", Path(__file__).resolve().parents[1] / "tools" / "comfy-model-manifest.py")
model_manifest = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(model_manifest)


class ComfyModelManifestTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "models"
        (self.root / "diffusion_models").mkdir(parents=True)
        (self.root / "text_encoders").mkdir()
        (self.root / "diffusion_models" / "h3-int8.safetensors").write_bytes(b"weight-bytes")
        (self.root / "text_encoders" / "qwen-awq.gguf").write_bytes(b"text-encoder")
        self.api = {
            "1": {"class_type": "UNETLoader", "inputs": {"unet_name": "h3-int8.safetensors", "weight_dtype": "int8"}},
            "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": "qwen-awq.gguf"}},
            "3": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "h3-int8.safetensors"}},
            "4": {"class_type": "SaveVideo", "inputs": {"filename_prefix": "output.mp4"}},
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_hashes_workflow_requested_files_without_claiming_runtime_load(self):
        workflow_path = Path(self.temp.name) / "workflow.json"
        content = json.dumps({"prompt": self.api}).encode()
        workflow_path.write_bytes(content)
        prompt, workflow_sha = model_manifest.load_prompt(workflow_path)
        report = model_manifest.manifest(prompt, workflow_sha, [self.root])
        self.assertEqual(report["schema"], "arc-comfy-model-files-v2")
        self.assertEqual(report["evidence"], "workflow-requested-files-present-and-hashed")
        self.assertFalse(report["runtimeLoadedVerified"])
        self.assertEqual(report["workflowSha256"], hashlib.sha256(content).hexdigest())
        self.assertEqual(report["modelSetSha256"], model_manifest.model_set_sha256(report["models"]))
        self.assertEqual([row["node"] for row in report["models"]], ["1", "2", "3"])
        self.assertEqual(report["models"][0]["sha256"], hashlib.sha256(b"weight-bytes").hexdigest())
        self.assertEqual(report["models"][0]["sizeBytes"], len(b"weight-bytes"))
        self.assertNotIn(str(self.root), json.dumps(report))
        self.assertNotIn("output.mp4", json.dumps(report))

    def test_model_set_identity_survives_prompt_graph_changes_but_changes_with_weight_choice(self):
        original = model_manifest.manifest(self.api, "a" * 64, [self.root])
        changed_graph = json.loads(json.dumps(self.api))
        changed_graph["4"]["inputs"]["filename_prefix"] = "different-prompt-output-name"
        same_models = model_manifest.manifest(changed_graph, "b" * 64, [self.root])
        self.assertNotEqual(original["workflowSha256"], same_models["workflowSha256"])
        self.assertEqual(original["modelSetSha256"], same_models["modelSetSha256"])
        (self.root / "diffusion_models" / "h3-int8-full.safetensors").write_bytes(b"full-weight-bytes")
        changed_graph["1"]["inputs"]["unet_name"] = "h3-int8-full.safetensors"
        different_models = model_manifest.manifest(changed_graph, "c" * 64, [self.root])
        self.assertNotEqual(original["modelSetSha256"], different_models["modelSetSha256"])

    def test_provider_bound_manifest_includes_endpoint_fingerprint(self):
        report = model_manifest.manifest(self.api, "a" * 64, [self.root], "d" * 64)
        self.assertEqual(report["schema"], "arc-comfy-model-files-v3")
        self.assertEqual(report["providerFingerprint"], "d" * 64)
        self.assertEqual(report["providerBinding"], "operator-supplied-endpoint-fingerprint")
        self.assertFalse(report["runtimeLoadedVerified"])
        with self.assertRaisesRegex(ValueError, "Provider fingerprint"):
            model_manifest.manifest(self.api, "a" * 64, [self.root], "not-a-digest")

    def test_missing_file_fails_instead_of_emitting_partial_manifest(self):
        self.api["5"] = {"class_type": "VAELoader", "inputs": {"vae_name": "missing.safetensors"}}
        with self.assertRaisesRegex(ValueError, "missing"):
            model_manifest.manifest(self.api, "a" * 64, [self.root])

    def test_duplicate_filename_fails_as_ambiguous(self):
        other = self.root / "loras"
        other.mkdir()
        (other / "h3-int8.safetensors").write_bytes(b"different bytes")
        with self.assertRaisesRegex(ValueError, "ambiguous filename"):
            model_manifest.manifest(self.api, "a" * 64, [self.root])

    def test_rejects_editor_format_and_invalid_node_graph(self):
        path = Path(self.temp.name) / "editor.json"
        path.write_text(json.dumps({"nodes": [{"id": 1}]}), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "API JSON"):
            model_manifest.load_prompt(path)

    def test_cli_writes_reusable_manifest(self):
        workflow_path = Path(self.temp.name) / "workflow-api.json"
        manifest_path = Path(self.temp.name) / "model-files.json"
        workflow_path.write_text(json.dumps(self.api), encoding="utf-8")
        tool = Path(__file__).resolve().parents[1] / "tools" / "comfy-model-manifest.py"
        result = subprocess.run([sys.executable, str(tool), "--workflow", str(workflow_path),
                                 "--models-root", str(self.root), "--output", str(manifest_path)],
                                check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(report["schema"], "arc-comfy-model-files-v2")
        self.assertEqual(len(report["models"]), 3)
        bound_path = Path(self.temp.name) / "model-files-bound.json"
        result = subprocess.run([sys.executable, str(tool), "--workflow", str(workflow_path),
                                 "--models-root", str(self.root), "--provider-fingerprint", "e" * 64,
                                 "--output", str(bound_path)], check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        bound = json.loads(bound_path.read_text(encoding="utf-8"))
        self.assertEqual(bound["schema"], "arc-comfy-model-files-v3")
        self.assertEqual(bound["providerFingerprint"], "e" * 64)
        self.assertEqual(bound["providerBinding"], "operator-supplied-endpoint-fingerprint")

    def test_cli_never_overwrites_existing_output_or_workflow(self):
        workflow_path = Path(self.temp.name) / "workflow-api.json"
        workflow_path.write_text(json.dumps(self.api), encoding="utf-8")
        tool = Path(__file__).resolve().parents[1] / "tools" / "comfy-model-manifest.py"
        existing_path = Path(self.temp.name) / "existing.json"
        existing_path.write_text("keep me", encoding="utf-8")
        result = subprocess.run([sys.executable, str(tool), "--workflow", str(workflow_path),
                                 "--models-root", str(self.root), "--output", str(existing_path)],
                                check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(existing_path.read_text(encoding="utf-8"), "keep me")
        result = subprocess.run([sys.executable, str(tool), "--workflow", str(workflow_path),
                                 "--models-root", str(self.root), "--output", str(workflow_path)],
                                check=False, capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(json.loads(workflow_path.read_text(encoding="utf-8")), self.api)


if __name__ == "__main__":
    unittest.main()
