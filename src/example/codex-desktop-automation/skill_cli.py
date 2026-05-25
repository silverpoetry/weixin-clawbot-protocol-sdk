import argparse
import sys
import time
import ctypes

try:
    import uiautomation as auto
except ImportError as exc:
    print(f"缺少依赖 uiautomation: {exc}")
    sys.exit(1)

try:
    import pyperclip
except ImportError as exc:
    print(f"缺少依赖 pyperclip: {exc}")
    sys.exit(1)


def set_clipboard_text(text, max_retries=3):
    for _ in range(max_retries):
        try:
            pyperclip.copy(text)
            time.sleep(0.05)
            if pyperclip.paste() == text:
                return True
        except Exception:
            pass
        time.sleep(0.1)
    return False


def fast_click(control, wait_time=0.05):
    control.Click(simulateMove=False, waitTime=wait_time)


def send_virtual_key(vk_code):
    user32 = ctypes.windll.user32
    user32.keybd_event(vk_code, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(vk_code, 0, 0x0002, 0)


def send_ctrl_key(vk_code):
    user32 = ctypes.windll.user32
    user32.keybd_event(0x11, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(vk_code, 0, 0, 0)
    time.sleep(0.03)
    user32.keybd_event(vk_code, 0, 0x0002, 0)
    time.sleep(0.03)
    user32.keybd_event(0x11, 0, 0x0002, 0)


def get_codex_window():
    candidates = [
        auto.WindowControl(searchDepth=1, Name="Codex"),
        auto.WindowControl(searchDepth=1, RegexName=".*Codex.*"),
        auto.PaneControl(searchDepth=1, Name="Codex"),
    ]

    for candidate in candidates:
        try:
            if candidate.Exists(0, 0):
                return candidate
        except Exception:
            continue

    return None


def activate_codex_window(window):
    try:
        window.SetActive()
        time.sleep(0.4)
        return True
    except Exception:
        return False


def send_text_via_focused_input(window, content):
    try:
        fast_click(window)
        time.sleep(0.1)
    except Exception:
        pass

    if not set_clipboard_text(content):
        return False

    # Codex Desktop does not reliably focus the composer until it receives a
    # real printable key event. Type "a", erase it, then paste the payload.
    send_virtual_key(0x41)
    time.sleep(0.05)
    send_virtual_key(0x08)
    time.sleep(0.1)
    send_ctrl_key(0x56)
    time.sleep(0.1)
    send_virtual_key(0x0D)
    time.sleep(0.2)
    return True


def main():
    parser = argparse.ArgumentParser(description="Codex 桌面端自动化发送工具")
    parser.add_argument("--content", required=True, help="要发送的文本消息")
    args = parser.parse_args()

    window = get_codex_window()
    if not window:
        print("未找到 Codex 桌面窗口，请确认 Codex 已启动")
        sys.exit(1)

    if not activate_codex_window(window):
        print("无法激活 Codex 桌面窗口")
        sys.exit(1)

    if not send_text_via_focused_input(window, args.content):
        print("发送失败，剪贴板不可用或无法向 Codex 输入框粘贴")
        sys.exit(1)

    print("发送成功")
    sys.exit(0)


if __name__ == "__main__":
    main()
