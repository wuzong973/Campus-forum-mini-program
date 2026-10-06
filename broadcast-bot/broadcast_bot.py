# -*- coding: utf-8 -*-
"""
微信群播报机器人：在「企业微信 PC 客户端」上自动发送论坛播报（UI 自动化，无协议注入）。

轮询服务器待发播报 -> 驱动企业微信 PC 客户端（模拟键盘）搜索群、粘贴文案、发送 -> 回报服务器。
配置见同目录 config.ini；运行日志写入 logs/bot.log。
"""
import configparser
import ctypes
import os
import re
import sys
import time
from datetime import datetime

import requests
import uiautomation as uiauto

# ===== 剪贴板直写（ctypes）=====
# 不用 uiautomation 的 SetClipboardText：该库写入时丢最后一个字符（实测踩坑，
# 群里短链末尾被截断即此因），这里直接调 Windows 剪贴板 API 精确写入完整内容。
_CF_UNICODETEXT = 13
_GMEM_MOVEABLE = 0x0002
_u32 = ctypes.WinDLL('user32', use_last_error=True)
_k32 = ctypes.WinDLL('kernel32', use_last_error=True)
_u32.OpenClipboard.argtypes = [ctypes.c_void_p]
_u32.SetClipboardData.restype = ctypes.c_void_p
_u32.SetClipboardData.argtypes = [ctypes.c_uint, ctypes.c_void_p]
_u32.GetClipboardData.restype = ctypes.c_void_p
_u32.GetClipboardData.argtypes = [ctypes.c_uint]
_k32.GlobalAlloc.restype = ctypes.c_void_p
_k32.GlobalAlloc.argtypes = [ctypes.c_uint, ctypes.c_size_t]
_k32.GlobalLock.restype = ctypes.c_void_p
_k32.GlobalLock.argtypes = [ctypes.c_void_p]
_k32.GlobalUnlock.argtypes = [ctypes.c_void_p]


def win_set_clipboard_text(text):
    """写入 CF_UNICODETEXT（含结尾 NUL，字节精确）。成功返回 True。"""
    data = text.encode('utf-16-le') + b'\x00\x00'
    for _ in range(5):
        if not _u32.OpenClipboard(None):
            time.sleep(0.15)
            continue
        try:
            _u32.EmptyClipboard()
            handle = _k32.GlobalAlloc(_GMEM_MOVEABLE, len(data))
            if not handle:
                return False
            ptr = _k32.GlobalLock(handle)
            ctypes.memmove(ptr, data, len(data))
            _k32.GlobalUnlock(handle)
            return bool(_u32.SetClipboardData(_CF_UNICODETEXT, handle))
        finally:
            _u32.CloseClipboard()
    return False


def win_get_clipboard_text():
    """读取 CF_UNICODETEXT；打不开剪贴板返回 None。"""
    for _ in range(5):
        if _u32.OpenClipboard(None):
            break
        time.sleep(0.15)
    else:
        return None
    try:
        handle = _u32.GetClipboardData(_CF_UNICODETEXT)
        if not handle:
            return None
        ptr = _k32.GlobalLock(handle)
        if not ptr:
            return None
        try:
            return ctypes.wstring_at(ptr)
        finally:
            _k32.GlobalUnlock(handle)
    finally:
        _u32.CloseClipboard()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, 'logs')


def log(message):
    line = '%s %s' % (datetime.now().strftime('%Y-%m-%d %H:%M:%S'), message)
    print(line, flush=True)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        with open(os.path.join(LOG_DIR, 'bot.log'), 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except OSError:
        pass


def load_config():
    path = os.path.join(BASE_DIR, 'config.ini')
    if not os.path.exists(path):
        log('缺少配置文件 config.ini，请参照交付包里的说明填写后重试')
        sys.exit(1)
    cp = configparser.ConfigParser()
    cp.read(path, encoding='utf-8')
    base_url = cp.get('server', 'base_url', fallback='').rstrip('/')
    token = cp.get('server', 'bot_token', fallback='')
    # 群名分隔符：英文逗号、中文逗号、顿号、分号都支持（甲方手输容易打中文标点）
    raw_names = cp.get('groups', 'names', fallback='')
    parsed = [x.strip() for x in re.split(r'[,，、;；]', raw_names) if x.strip()]
    # 去重（保序）：同名写两遍会让机器人重复发两轮，还会触发搜索误输隐患
    seen = set()
    group_names = []
    for n in parsed:
        if n not in seen:
            seen.add(n)
            group_names.append(n)
    poll_seconds = cp.getint('timing', 'poll_seconds', fallback=20)
    search_wait = cp.getfloat('timing', 'search_wait', fallback=2.0)
    paste_wait = cp.getfloat('timing', 'paste_wait', fallback=1.2)
    if not base_url or not token or not group_names:
        log('config.ini 配置不完整：base_url / bot_token / groups.names 都必填')
        sys.exit(1)
    return base_url, token, group_names, poll_seconds, search_wait, paste_wait


BASE_URL, BOT_TOKEN, GROUP_NAMES, POLL_SECONDS, SEARCH_WAIT, PASTE_WAIT = load_config()


def api_pending():
    r = requests.get(
        BASE_URL + '/api/v1/broadcast/pending',
        headers={'X-Bot-Token': BOT_TOKEN},
        timeout=10,
    )
    r.raise_for_status()
    return r.json().get('data')


def api_mark_sent(broadcast_id):
    r = requests.post(
        BASE_URL + '/api/v1/broadcast/%s/sent' % broadcast_id,
        headers={'X-Bot-Token': BOT_TOKEN},
        timeout=10,
    )
    r.raise_for_status()


def find_wechat_work_window():
    # 必须用窗口类名匹配：企业微信 PC 客户端主窗口的类是 WeWorkWindow。
    # 不能按标题找「企业微信」——浏览器开着企微管理后台时，浏览器窗口标题
    # 也含「企业微信」，会被误当成客户端（实测踩坑：消息全发进了浏览器）。
    win = uiauto.WindowControl(searchDepth=1, ClassName='WeWorkWindow')
    if not win.Exists(3, 1):
        raise RuntimeError(
            '未找到企业微信客户端窗口（窗口类 WeWorkWindow）：'
            '请确认企业微信已登录且主窗口开着（可最小化）'
        )
    return win


def screenshot(win, tag):
    """关键步骤截图存到 logs\，用于远程排查『ok 但群里没有』类问题。"""
    try:
        path = os.path.join(LOG_DIR, '%s_%s.png' % (time.strftime('%H%M%S'), tag))
        win.CaptureToImage(path)
        log('  截图: %s' % os.path.basename(path))
    except Exception as e:
        log('  截图失败: %s' % e)


def find_session_item(win, name):
    """在左侧会话列表里按群名**精确**查找会话项（只读检测，不产生任何键盘输入）。
    必须精确匹配：群名带编号（如「…群6️⃣」）时，前缀匹配会误开成其它编号的群。"""
    patterns = ['^' + re.escape(name) + '$', '^' + re.escape(name) + r'\s*$']
    for pattern in patterns:
        try:
            item = win.ListItemControl(searchDepth=12, RegexName=pattern)
            if item.Exists(0.8, 0):
                return item
        except Exception:
            continue
    return None


def open_group(win, name, idx):
    """打开目标群：优先点击左侧会话列表项（零键盘输入，群名不会误发进聊天）；
    列表里没有时才回退到 Ctrl+F 搜索。"""
    win.SetActive()
    time.sleep(0.3)
    item = find_session_item(win, name)
    if item is not None:
        item.Click(simulateMove=False)
        time.sleep(0.8)
        screenshot(win, 'opened_%d' % idx)
        return
    # 回退：搜索打开（若 Ctrl+F 未抢到焦点，输入会落进聊天输入框——
    # 这是历史踩坑「群名被当消息发出去」的成因，故优先走上面的列表点击）
    log('  会话列表未找到「%s」，回退用搜索打开' % name)
    win.SendKeys('{Ctrl}f')
    time.sleep(0.8)
    win.SendKeys(name, interval=0.03)
    time.sleep(SEARCH_WAIT)
    screenshot(win, 'search_%d' % idx)
    win.SendKeys('{Enter}')
    time.sleep(0.8)
    screenshot(win, 'opened_%d' % idx)
    # 注意：此处不要盲点击窗口其他区域——打开会话后焦点本就在输入框，
    # 点歪（如点到聊天消息区）会把输入框焦点点没，导致粘贴落空（实测踩坑）。


def get_input_edit(win):
    try:
        candidate = win.EditControl(searchDepth=12)
        if candidate.Exists(1, 0):
            return candidate
    except Exception:
        pass
    return None


def input_text(edit):
    """读输入框内容；读不到返回 None（与空串区分）。"""
    try:
        return edit.GetValue() or ''
    except Exception:
        return None


def wait_paste_settled(win, content):
    """粘贴是异步插入：回车太快会把没插完的尾巴截掉（实测入口短链被截断）。
    优先读输入框内容、确认结尾短链已完整再回车；读不到就退回固定等待。"""
    tail = content[-8:]
    edit = get_input_edit(win)
    if edit is None:
        time.sleep(PASTE_WAIT)
        return
    deadline = time.time() + 4.0
    while time.time() < deadline:
        value = input_text(edit)
        if value is None:
            log('  读取输入框失败，按兜底等待 %s 秒后发送' % PASTE_WAIT)
            time.sleep(PASTE_WAIT)
            return
        if tail in value[-60:]:
            log('  输入框内容已完整（%d 字），发送' % len(value))
            return
        time.sleep(0.3)
    log('  未能确认输入框内容完整，按兜底等待 %s 秒后发送' % PASTE_WAIT)
    time.sleep(PASTE_WAIT)


def set_clipboard_verified(content, retries=5):
    """写入剪贴板并回读校验（逐字节一致），确保粘贴源内容完整。失败时记录细节。"""
    for i in range(retries):
        set_ok = False
        back = None
        err = ''
        try:
            set_ok = win_set_clipboard_text(content)
            back = win_get_clipboard_text()
        except Exception as e:
            err = repr(e)
        if set_ok and back == content:
            return True
        log('  剪贴板第 %d 次校验失败: set_ok=%s get=%r err=%s' % (
            i + 1, set_ok, (back[:30] + '…(%d字)' % len(back)) if back else back, err))
        time.sleep(0.3)
    return False


def send_text(win, content, idx):
    """粘贴文案到聊天输入框（开群后焦点默认在输入框，不要盲点击其他区域，
    点歪会把输入框焦点点没——实测粘贴落空），等插入完成再回车发送。"""
    if not set_clipboard_verified(content):
        raise RuntimeError('剪贴板写入校验失败（可能有其他程序占用剪贴板）')
    time.sleep(0.2)
    uiauto.SendKeys('{Ctrl}v', waitTime=0.2)
    screenshot(win, 'pasted_%d' % idx)
    wait_paste_settled(win, content)

    edit = get_input_edit(win)
    sent = False
    # 发送后若能读到输入框，校验已清空才算成功；读不到（部分企微版本）按截图回溯
    for attempt, keys in enumerate(['{Enter}', '{Ctrl}{Enter}', '{Enter}']):
        uiauto.SendKeys(keys, waitTime=0.6)
        value = input_text(edit) if edit is not None else ''
        if value is None or not value.strip():
            sent = True
            log('  第 %d 次「%s」发送成功' % (attempt + 1, 'Enter' if keys == '{Enter}' else 'Ctrl+Enter'))
            break
        log('  第 %d 次发送键后输入框仍有 %d 字，换键重试' % (attempt + 1, len(value)))
    screenshot(win, 'sent_%d' % idx)
    return sent


def send_to_groups(content):
    win = find_wechat_work_window()
    results = []
    for idx, name in enumerate(GROUP_NAMES, 1):
        try:
            open_group(win, name, idx)
            ok = send_text(win, content, idx)
            results.append((name, 'ok' if ok else
                '失败: 回车后消息仍留在输入框（检查企微「设置-通用-按Enter键发送消息」）'))
        except Exception as e:  # 单个群失败不影响其他群
            results.append((name, '失败: %s' % e))
    return results


def main():
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    log('论坛播报机器人启动；轮询 %s 秒；目标群：%s；服务器：%s' % (POLL_SECONDS, GROUP_NAMES, BASE_URL))
    while True:
        try:
            item = api_pending()
            if item:
                log('领取到播报 #%s（%s 条新帖），开始发送…' % (item['id'], item.get('postCount')))
                results = send_to_groups(item['content'])
                all_ok = all(status == 'ok' for _, status in results)
                for name, status in results:
                    log('  -> %s %s' % (name, status))
                if all_ok:
                    api_mark_sent(item['id'])
                    log('播报 #%s 已全部发出并回报' % item['id'])
                else:
                    # 不回报 -> 服务端抢占锁 5 分钟后过期，下轮自动重试
                    log('存在失败群，%d 秒后自动重试' % POLL_SECONDS)
            else:
                log('暂无待发播报')
        except KeyboardInterrupt:
            log('收到手动停止，退出')
            break
        except Exception as e:
            log('轮询异常: %s' % e)
        time.sleep(POLL_SECONDS)


if __name__ == '__main__':
    main()
