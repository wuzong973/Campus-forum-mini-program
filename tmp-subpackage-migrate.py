# 一次性分包迁移脚本（用后即删）：
# 1) 移动低频功能页目录到 pkg-feature/pages/
# 2) app.json pages/subPackages 重写
# 3) 被移动文件的相对依赖 ../../ -> ../../../
# 4) 全局导航引用 '/pages/<name>' -> '/pkg-feature/pages/<name>'
# 5) 测试中的旧路径同步替换
import json, io, os, shutil, re

ROOT = os.path.dirname(os.path.abspath(__file__))
MOVED_DIRS = ['review', 'club', 'group-chat', 'activity', 'driving-school', 'feedback', 'wallet',
              'rider-verify', 'repair', 'poster', 'banner-detail', 'campus-map', 'help', 'market',
              'announcements', 'rules', 'about', 'agreement', 'privacy', 'service-all', 'security']
NEW_PREFIX = 'pkg-feature/pages/'

# ---- 1) 移动目录 ----
for d in MOVED_DIRS:
    src = os.path.join(ROOT, 'pages', d)
    dst = os.path.join(ROOT, 'pkg-feature', 'pages', d)
    if os.path.exists(src):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.move(src, dst)
        print('moved', d)

# ---- 2) app.json ----
app_json_path = os.path.join(ROOT, 'app.json')
c = json.load(io.open(app_json_path, encoding='utf-8'))
prefixes = tuple('pages/' + d + '/' for d in MOVED_DIRS)
moved_pages = [p for p in c['pages'] if p.startswith(prefixes)]
c['pages'] = [p for p in c['pages'] if not p.startswith(prefixes)]
c.setdefault('subPackages', []).append({
    'root': 'pkg-feature',
    'pages': [p[len('pages/'):] for p in moved_pages]
})
io.open(app_json_path, 'w', encoding='utf-8', newline='').write(json.dumps(c, ensure_ascii=False, indent=2))
print('app.json: moved', len(moved_pages), 'pages into pkg-feature')

# ---- 3) 被移动文件相对依赖 ../../ -> ../../../ ----
# pages/<dir>/file.js 深度为 2；pkg-feature/pages/<dir>/file.js 深度为 3
changed = 0
for d in MOVED_DIRS:
    base = os.path.join(ROOT, 'pkg-feature', 'pages', d)
    for dp, _, files in os.walk(base):
        for name in files:
            if not name.endswith(('.js', '.wxml', '.wxss', '.json')):
                continue
            path = os.path.join(dp, name)
            s = io.open(path, encoding='utf-8').read()
            orig = s
            # js require / wxml import&include / wxss @import 的两级相对路径
            s = re.sub(r"(require\(')\.\./\.\./", r"\1../../../", s)
            s = re.sub(r'(")(\.\./\.\./)(?!../)', r'\1../../../', s)  # require("../../x")
            s = re.sub(r"(src=\")\.\./\.\./", r"\1../../../", s)      # wxml import/include
            s = re.sub(r"(@import \")\.\./\.\./", r"\1../../../", s)  # wxss @import
            s = s.replace('"../../', '"../../../')
            if s != orig:
                io.open(path, 'w', encoding='utf-8', newline='').write(s)
                changed += 1
print('relative deps fixed in', changed, 'files')

# ---- 4) 全局导航引用替换（pages/components/utils/app.js + 测试） ----
nav_targets = []
for dirpath, _, files in os.walk(ROOT):
    rel = os.path.relpath(dirpath, ROOT).replace('\\', '/')
    if rel.startswith(('node_modules', 'server', 'pkg-admin', 'pkg-schedule', 'pkg-feature', '.git', 'docs',
                       'broadcast-bot', 'jw-crawler', '.mimosa', '.workbuddy', '.video_agent', '.claude')):
        continue
    for name in files:
        if name.endswith(('.js', '.wxml', '.json')):
            nav_targets.append(os.path.join(dirpath, name))

url_count = 0
for path in nav_targets:
    s = io.open(path, encoding='utf-8').read()
    orig = s
    for d in MOVED_DIRS:
        s = s.replace('/pages/' + d + '/', '/pkg-feature/pages/' + d + '/')
    if s != orig:
        io.open(path, 'w', encoding='utf-8', newline='').write(s)
        url_count += 1
print('nav refs updated in', url_count, 'files')

# ---- 5) 测试路径替换 ----
test_dir = os.path.join(ROOT, 'server', 'tests')
t_count = 0
for name in os.listdir(test_dir):
    if not name.endswith('.test.js'):
        continue
    path = os.path.join(test_dir, name)
    s = io.open(path, encoding='utf-8').read()
    orig = s
    for d in MOVED_DIRS:
        s = s.replace('pages/' + d + '/', 'pkg-feature/pages/' + d + '/')
        s = s.replace('pages\\' + d + '\\', 'pkg-feature\\pages\\' + d + '\\')
    if s != orig:
        io.open(path, 'w', encoding='utf-8', newline='').write(s)
        t_count += 1
print('test paths updated in', t_count, 'files')
print('MIGRATION DONE')
