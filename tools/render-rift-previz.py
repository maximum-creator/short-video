"""Render original white-model blocking clips with NumPy, Pillow and FFmpeg."""

import math
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw


WIDTH, HEIGHT, FPS, SECONDS = 640, 360, 24, 4
FOCAL = 700
CAMERA = np.array([2.45, -6.1, 2.25])
TARGET = np.array([0., 0., 1.32])


def unit(vector):
    return vector / np.linalg.norm(vector)


FORWARD = unit(TARGET - CAMERA)
RIGHT = unit(np.cross(FORWARD, [0., 0., 1.]))
UP = np.cross(RIGHT, FORWARD)
VIEW = np.array([RIGHT, UP, FORWARD]).T
KEY = unit(np.array([-3., -4., 6.]))
RINGS, SIDES = 10, 16
SPHERE = np.array([
    [math.sin(phi) * math.cos(theta), math.sin(phi) * math.sin(theta), math.cos(phi)]
    for phi in np.linspace(0, math.pi, RINGS + 1)
    for theta in np.arange(SIDES) * (2 * math.pi / SIDES)
])
QUADS = np.array([
    [ring * SIDES + i, ring * SIDES + (i + 1) % SIDES,
     (ring + 1) * SIDES + (i + 1) % SIDES, (ring + 1) * SIDES + i]
    for ring in range(RINGS) for i in range(SIDES)
])
NORMALS = SPHERE[QUADS].mean(axis=1)
NORMALS /= np.linalg.norm(NORMALS, axis=1)[:, None]


def project(points):
    view = (points - CAMERA) @ VIEW
    depth = view[:, 2]
    screen = np.column_stack((WIDTH * .5 + FOCAL * view[:, 0] / depth,
                              HEIGHT * .48 - FOCAL * view[:, 1] / depth))
    return screen, depth


def smooth(time, start, end):
    t = max(0., min(1., (time - start) / (end - start)))
    return t * t * (3 - 2 * t)


def planted_knee(hip, ankle, forward=(0., -1., 0.)):
    axis = unit(ankle - hip)
    distance = np.linalg.norm(ankle - hip)
    thigh, shin = .60, .56
    if not abs(thigh - shin) < distance < thigh + shin:
        raise ValueError('Foot trajectory is outside the leg reach.')
    along = (thigh * thigh - shin * shin + distance * distance) / (2 * distance)
    bent = math.sqrt(max(0., thigh * thigh - along * along))
    forward = np.asarray(forward)
    bend_direction = unit(forward - axis * (forward @ axis))
    return hip + axis * along + bend_direction * bent


def painter(faces, backlight=0.):
    def ellipsoid(center, radii, color, basis=np.eye(3)):
        points, depth = project((SPHERE * radii) @ basis + center)
        normals = (NORMALS / radii) @ basis
        normals /= np.linalg.norm(normals, axis=1)[:, None]
        diffuse = np.maximum(0, normals @ KEY)
        taper = np.clip(.48 + .47 * diffuse + .13 * backlight * np.maximum(0, normals[:, 1]), 0, 1)
        for face, light in zip(QUADS, taper):
            faces.append((float(depth[face].mean()), list(map(tuple, points[face])),
                          tuple(int(channel * light) for channel in color)))

    def limb(start, end, radius, color=(229, 226, 219)):
        start, end = np.array(start), np.array(end)
        direction = unit(end - start)
        cross_axis = [1., 0., 0.] if abs(direction[0]) < .99 else [0., 1., 0.]
        side = unit(np.cross(direction, cross_axis))
        basis = np.array([np.cross(side, direction), side, direction])
        ellipsoid((start + end) * .5, np.array([radius, radius, np.linalg.norm(end - start) * .5 + .036]),
                  color, basis)
    return ellipsoid, limb


def stage(ice=False):
    image = Image.new('RGB', (WIDTH, HEIGHT))
    draw = ImageDraw.Draw(image)
    for y in range(HEIGHT):
        value = int(25 + 37 * (y / HEIGHT) ** 1.4)
        draw.line((0, y, WIDTH, y), fill=(value, value + (9 if ice else 3), value + (16 if ice else 7)))
    for x in np.arange(-7, 8):
        points, _ = project(np.array([[x, -4., 0.], [x, 7., 0.]]))
        draw.line(list(map(tuple, points)), fill=(48, 51, 57))
    for y in np.arange(-4, 8):
        points, _ = project(np.array([[-8., y, 0.], [8., y, 0.]]))
        draw.line(list(map(tuple, points)), fill=(48, 51, 57))
    return image, draw


def paint(draw, faces):
    for _, polygon, color in sorted(faces, key=lambda face: -face[0]):
        draw.polygon(polygon, fill=color)


def frame(time, doorway=False):
    image, draw = stage()
    opening = smooth(time, .15, .85)
    movement = smooth(time, .54, 2.33)
    head_turn = smooth(time, 2.50, 3.25)
    root_y = .68 - .83 * movement
    root_z = 1.038 + .019 * math.sin(movement * math.pi)
    theta = np.linspace(0, math.tau, 100)
    shadow, _ = project(np.column_stack((.38 * np.cos(theta),
                                         root_y + .58 * np.sin(theta),
                                         np.full_like(theta, .006))))
    draw.polygon(list(map(tuple, shadow)), fill='#313239')
    faces = []
    ellipsoid, limb = painter(faces, 0. if doorway else opening)

    # The opening appears behind the actor. Broken arcs leave a readable silhouette.
    arcs = () if doorway else ((.05, 1.37), (1.53, 2.91), (3.03, 4.16), (4.27, 5.28), (5.42, 6.18))
    for start, end in arcs:
        angle = np.linspace(start, end, 22)
        radii = (.84 + .37 * opening, 1.40)
        coords = np.column_stack((radii[0] * np.cos(angle), np.full_like(angle, .55),
                                  1.42 + radii[1] * np.sin(angle)))
        screen, depth = project(coords)
        for a, b, z in zip(screen, screen[1:], depth):
            x1, y1 = a
            x2, y2 = b
            for width, base in ((6, (48, 75, 98)), (3, (116, 181, 214)), (1, (186, 233, 247))):
                value = tuple(int(channel * (.17 + .83 * opening)) for channel in base)
                faces.append((z + width * .0001, [(x1 - width, y1), (x2 - width, y2),
                                                  (x2 + width, y2), (x1 + width, y1)], value))

    if doorway:
        guide = (120, 122, 123)
        for side in (-.63, .63):
            limb([side, .36, .04], [side, .36, 2.11], .035, guide)
        limb([-.63, .36, 2.11], [.63, .36, 2.11], .04, guide)
        limb([-.63, .36, .026], [.63, .36, .026], .029, guide)

    ellipsoid([0., root_y, root_z + .07], np.array([.24, .16, .21]), (217, 216, 210))
    ellipsoid([0., root_y, root_z + .33], np.array([.28, .16, .32]), (233, 230, 222))
    limb([0., root_y, root_z + .50], [0., root_y, root_z + .65], .07)
    ellipsoid([.023 * head_turn, root_y - .01, root_z + .73], np.array([.108, .104, .158]),
              (242, 237, 226))
    ellipsoid([.076 * head_turn, root_y - .096 + .028 * head_turn, root_z + .73],
              np.array([.032, .043, .05]), (244, 238, 225))

    for side in (-1, 1):
        step = smooth(time, .77, 1.54) if side == -1 else smooth(time, 1.55, 2.48)
        start_y = .50 if side == -1 else .75
        distance = .80 if side == -1 else .91
        foot_y = start_y - distance * step
        lift = .17 * math.sin(math.pi * step)
        ankle = np.array([side * .128, foot_y, .08 + lift])
        hip = np.array([side * .128, root_y, root_z + .02])
        knee = planted_knee(hip, ankle)
        limb(hip, knee, .094)
        limb(knee, ankle, .068)
        ellipsoid([ankle[0], ankle[1] - .06, ankle[2] - .024], np.array([.072, .138, .055]), (226, 223, 213))
        swing = side * (.13 * math.sin(movement * math.tau))
        shoulder = [side * .246, root_y, root_z + .44]
        elbow = [side * .31, root_y + .035 + swing, root_z + .24]
        wrist = [side * .32, root_y - .082 + swing * 1.5, root_z + .052]
        limb(shoulder, elbow, .065)
        limb(elbow, wrist, .052)
        ellipsoid(wrist, np.array([.052, .050, .083]), (234, 229, 218))

    paint(draw, faces)
    return image


def skating_frame(time):
    image, draw = stage(ice=True)
    # Vary the direction continuously and keep the supporting blade on the curve.
    progress = min(time / SECONDS, 1.)
    extension = smooth(time, .32, 1.52) * (1 - smooth(time, 2.38, 3.48))
    path = lambda t: np.array([-1.60 + 3.2 * t, .38 - 1.26 * t + 1.10 * t * t, 0.])
    position = path(progress)
    forward = unit(np.array([3.2, -1.26 + 2.2 * progress, 0.]))
    side = np.array([-forward[1], forward[0], 0.])
    up = np.array([0., 0., 1.])
    basis = np.array([side, forward, up])

    theta = np.linspace(0, math.tau, 48)
    shadow, _ = project(position + np.outer(.32 * np.cos(theta), side) +
                        np.outer(.43 * np.sin(theta), forward))
    draw.polygon(list(map(tuple, shadow)), fill='#343f4a')
    trace, _ = project(np.array([path(t) for t in np.linspace(0, progress, 65)]))
    draw.line(list(map(tuple, trace)), fill=(158, 204, 224), width=2)
    faces = []
    ellipsoid, limb = painter(faces)

    def center(across, along, height):
        return position + across * side + along * forward + height * up

    def skate(ankle, direction):
        blade_side = unit(np.cross(direction, up))
        blade_up = np.cross(blade_side, direction)
        skate_basis = np.array([blade_side, direction, blade_up])
        ellipsoid(ankle + direction * .056 - blade_up * .036,
                  np.array([.073, .152, .060]), (234, 230, 218), skate_basis)
        limb(ankle - direction * .075 - blade_up * .127,
             ankle + direction * .186 - blade_up * .127, .015, (137, 185, 208))

    hip = center(.055, -.055, 1.135 - .09 * extension)
    support = center(0., 0., .142)
    # Use the skating direction for the supporting knee, not the camera orientation.
    knee = planted_knee(hip, support, forward)
    limb(hip, knee, .091)
    limb(knee, support, .066)
    skate(support, forward)

    free_hip = hip + side * .152
    thigh_angle = math.radians(12 + 62 * extension)
    shin_angle = math.radians(31 + 40 * extension)
    free_knee = free_hip - .56 * (math.sin(thigh_angle) * forward + math.cos(thigh_angle) * up)
    free_ankle = free_knee - .49 * (math.sin(shin_angle) * forward + math.cos(shin_angle) * up)
    limb(free_hip, free_knee, .086)
    limb(free_knee, free_ankle, .064)
    skate(free_ankle, unit(forward - .36 * up))

    torso_angle = .64 * extension
    trunk = math.sin(torso_angle) * forward + math.cos(torso_angle) * up
    ribs = hip + side * .045 + .34 * trunk
    neck = hip + side * .045 + .60 * trunk
    ellipsoid(hip + side * .065, np.array([.216, .147, .175]), (216, 216, 208), basis)
    back = np.cross(side, trunk)
    ellipsoid(ribs, np.array([.238, .146, .294]), (232, 228, 218), np.array([side, back, trunk]))
    head = neck + .143 * up + .062 * forward
    limb(neck - .068 * trunk, head - .106 * up, .056)
    ellipsoid(head, np.array([.092, .096, .125]), (242, 237, 227), basis)
    ellipsoid(head + .091 * forward, np.array([.029, .033, .042]), (240, 235, 224), basis)
    for sign in (-1, 1):
        shoulder = neck - .105 * trunk + sign * .193 * side
        out = sign * side
        elbow = shoulder + .30 * unit((.13 + .19 * extension) * out - (.24 - .20 * extension) * up)
        wrist = elbow + .26 * unit((.08 + .19 * extension) * out +
                                   (.04 + sign * .14 * extension) * forward - .17 * (1 - extension) * up)
        limb(shoulder, elbow, .055)
        limb(elbow, wrist, .040)
        ellipsoid(wrist, np.array([.051, .060, .037]), (236, 229, 220), basis)
    paint(draw, faces)
    return image


LIFT, CONTACT, LAND = .82, 1.375, 2.20


def stunt_pose(time):
    """Block a fictional floating prop beat with separate actor and prop motion."""
    tuck = smooth(time, LIFT, 1.13) * (1 - smooth(time, 1.75, LAND))
    extension = smooth(time, 1.08, CONTACT) * (1 - smooth(time, 1.46, 1.80))
    air = np.clip((time - LIFT) / (LAND - LIFT), 0., 1.)
    settle = smooth(time, LAND, 2.34) * (1 - smooth(time, 2.34, 2.80))
    hip = np.array([-1.34 + .84 * smooth(time, LIFT, LAND), 0.,
                   1.10 + .61 * math.sin(math.pi * air) -
                   .14 * smooth(time, .30, .68) * (1 - smooth(time, .68, LIFT)) - .14 * settle])
    legs = []
    for side in (-1, 1):
        joint = hip + np.array([0., .126 * side, 0.])
        if 0 < air < 1:
            upper = math.radians(26 + (32 * tuck + 22 * extension if side < 0 else 26 * tuck))
            lower = math.radians(-30 + (113 * extension - 17 * tuck * (1 - extension) if side < 0 else -38 * tuck))
            knee = joint + .60 * np.array([math.sin(upper), 0., -math.cos(upper)])
            ankle = knee + .56 * np.array([math.sin(lower), 0., -math.cos(lower)])
        else:
            ankle = np.array([hip[0] - .10 * side, joint[1], .074])
            knee = planted_knee(joint, ankle, [1., 0., 0.])
        toe = ankle + np.array([.142, -.006, .014 * extension])
        legs.append((joint, knee, ankle, toe))
    return hip, extension, tuck, legs


def stunt_frame(time):
    image, draw = stage()
    hip, extension, tuck, legs = stunt_pose(time)
    faces = []
    glow = smooth(time, CONTACT - .075, CONTACT + .02) * (1 - smooth(time, CONTACT + .04, CONTACT + .32))
    ellipsoid, limb = painter(faces, glow)
    theta = np.linspace(0, math.tau, 48)
    shadow, _ = project(np.column_stack((hip[0] + .37 * np.cos(theta), .30 * np.sin(theta), np.zeros_like(theta))))
    draw.polygon(list(map(tuple, shadow)), fill='#34343e')
    tilt = np.array([-.35 * extension, .05 * tuck, 1.])
    chest = hip + .35 * tilt
    neck = hip + .61 * tilt
    ellipsoid(hip, np.array([.166, .239, .174]), (220, 216, 213))
    ellipsoid(chest, np.array([.171, .252, .294]), (236, 229, 217))
    head = neck + np.array([.034, -.024, .117])
    limb(neck - np.array([0., 0., .07]), head, .064)
    ellipsoid(head, np.array([.104, .097, .143]), (242, 233, 222))
    ellipsoid(head + np.array([.097, -.032, -.006]), np.array([.033, .032, .051]), (242, 233, 222))
    for side, (joint, knee, ankle, toe) in zip((-1, 1), legs):
        limb(joint, knee, .091)
        limb(knee, ankle, .066)
        limb(ankle, toe - np.array([.042, 0., .026]), .057)
        shoulder = neck + np.array([0., side * .213, -.104])
        elbow = shoulder + .289 * unit(np.array([-side * (.11 + .25 * tuck), side * .15, -.30 + .23 * tuck]))
        wrist = elbow + .246 * unit(np.array([-.09 + side * .31 * tuck, side * .06, -.26 + .24 * tuck]))
        limb(shoulder, elbow, .056)
        limb(elbow, wrist, .046)
        ellipsoid(wrist, np.array([.045, .044, .062]), (236, 229, 220))

    # The visible contact marker is shared by the pose and the stylized prop.
    toe_at_contact = stunt_pose(CONTACT)[3][0][3]
    travel = smooth(time, CONTACT, 2.58)
    prop_end = toe_at_contact + np.array([.049 + 1.23 * travel, 0., .28 * travel + .024 * math.sin(5 * time) * (1 - smooth(time, 1.16, CONTACT))])
    axis = unit(np.array([1., 0., .16 + .35 * travel]))
    cross = np.array([-axis[2], 0., axis[0]])
    limb(prop_end, prop_end + .27 * axis, .033, (171, 133, 121))
    guard = prop_end + .28 * axis
    limb(guard - .11 * cross, guard + .11 * cross, .039, (197, 163, 133))
    limb(guard, guard + .66 * axis, .069, (220, 183, 235))
    paint(draw, faces)
    if glow > 0:
        for radius in (.10, .21, .34):
            angles = np.linspace(-1.5, 1.5, 24)
            arc = toe_at_contact + np.column_stack((radius * np.cos(angles), np.zeros_like(angles), radius * np.sin(angles)))
            points, _ = project(arc)
            draw.line(list(map(tuple, points)), fill=(int(106 + 130 * glow), int(83 + 110 * glow), int(123 + 114 * glow)), width=2)
    return image


def acting_frame(time, reaches=False):
    image, draw = stage()
    faces = []
    ellipsoid, limb = painter(faces)
    move = smooth(time, .8, 1.65)
    settle = smooth(time, 2.0, 3.15)
    action = move * (1 - settle)
    hip = np.array([-.43 if reaches else 0., 0., 1.06])
    lean = np.array([.095 * action, -.04 * action, 0.])
    ellipsoid(hip, np.array([.21, .14, .17]), (219, 216, 210))
    ellipsoid(hip + lean + [0., 0., .32], np.array([.25, .15, .31]), (235, 230, 221))
    head = hip + lean + [.075 * move if not reaches else .08 * action, 0., .73 + .055 * move]
    limb(hip + lean + [0., 0., .51], head, .069)
    ellipsoid(head, np.array([.102, .096, .151]), (242, 234, 222))
    direction = unit(np.array([(.8 if reaches else .93) * move, -1., .30 * action]))
    ellipsoid(head + .093 * direction, np.array([.038, .034, .045]), (244, 235, 222))
    for side in (-1, 1):
        joint = hip + [side * .12, 0., 0.]
        foot = hip + [side * .14, side * .09, -.982]
        knee = planted_knee(joint, foot)
        limb(joint, knee, .083)
        limb(knee, foot, .062)
        ellipsoid(foot + [0., -.058, -.025], np.array([.067, .111, .052]), (223, 220, 212))
        shoulder = hip + lean + [side * .22, 0., .45]
        amount = action if reaches and side == 1 else 0.
        elbow = shoulder + [side * (.09 + .15 * amount), -.07 * amount, -.26 + .13 * amount]
        hand = elbow + [side * (.018 + .23 * amount), -.055 - .053 * amount, -.23 + .258 * amount]
        limb(shoulder, elbow, .06)
        limb(elbow, hand, .046)
        ellipsoid(hand, np.array([.052, .043, .055]), (240, 230, 218))
    if reaches:
        for x in (.34, 1.04):
            for y in (-.41, .23):
                limb([x, y, .03], [x, y, 1.13], .038, (85, 104, 112))
        limb([.29, -.1, 1.13], [1.09, -.1, 1.13], .19, (103, 126, 133))
        ellipsoid([.48, -.16, 1.32], np.array([.071, .064, .054]), (241, 170, 94))
    paint(draw, faces)
    return image


def render(output, draw_frame):
    command = [
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-n', '-f', 'rawvideo',
        '-pixel_format', 'rgb24', '-video_size', f'{WIDTH}x{HEIGHT}', '-framerate', str(FPS),
        '-i', '-', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19',
        '-movflags', '+faststart', str(output),
    ]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as encoder:
        with encoder.stdin:
            for index in range(SECONDS * FPS):
                encoder.stdin.write(draw_frame(index / FPS).tobytes())
        if encoder.wait():
            raise RuntimeError('FFmpeg did not finish the preview.')


if __name__ == '__main__':
    scenes = {'rift': frame, 'skate': skating_frame, 'kick': stunt_frame,
              'look': acting_frame, 'reach': lambda time: acting_frame(time, reaches=True)}
    output = Path(sys.argv[1])
    scene = sys.argv[2] if len(sys.argv) > 2 else 'rift'
    if scene == 'doorway':
        WIDTH, HEIGHT, FOCAL = 360, 640, 1120
        draw_frame = lambda time: frame(time, doorway=True)
    else:
        draw_frame = scenes[scene]
    if output.suffix.lower() == '.png':
        with output.open('xb') as file:
            draw_frame(1.67).save(file, format='PNG')
    else:
        render(output, draw_frame)
