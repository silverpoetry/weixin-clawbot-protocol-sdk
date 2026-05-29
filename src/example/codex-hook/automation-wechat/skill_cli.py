import argparse
import sys
import time

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


def get_wechat_window():
    wx = auto.WindowControl(searchDepth=1, Name="微信", ClassName="mmui::MainWindow")
    if wx.Exists(0, 0):
        return wx

    auto.SendKeys("{Ctrl}{Alt}w", waitTime=0.1)
    time.sleep(1.0)
    wx = auto.WindowControl(searchDepth=1, Name="微信", ClassName="mmui::MainWindow")
    if wx.Exists(0, 0):
        return wx

    return None


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


def is_session_selected(session_item):
    try:
        pattern = session_item.GetPattern(10010)
        if pattern and hasattr(pattern, "IsSelected"):
            return bool(pattern.IsSelected)
    except Exception:
        return False
    return False


def fast_click(control, wait_time=0.05):
    control.Click(simulateMove=False, waitTime=wait_time)


def get_foreground_control():
    try:
        return auto.GetForegroundControl()
    except Exception:
        return None


def get_native_window_handle(control):
    try:
        return control.NativeWindowHandle
    except Exception:
        return 0


def get_selected_session_name(wx):
    try:
        session_list = wx.Control(
            ClassName="mmui::XTableView",
            AutomationId="session_list",
            searchDepth=20,
        )
        if not session_list.Exists(0, 0):
            return None
        for child in session_list.GetChildren():
            if child.ClassName == "mmui::ChatSessionCell" and is_session_selected(child):
                automation_id = str(child.AutomationId or "")
                if automation_id.startswith("session_item_"):
                    return automation_id[len("session_item_") :]
    except Exception:
        return None
    return None


def restore_contact(wx, contact_name):
    if not contact_name:
        return
    session_item = wx.Control(
        ClassName="mmui::ChatSessionCell",
        AutomationId=f"session_item_{contact_name}",
        searchDepth=20,
    )
    if session_item.Exists(0, 0):
        fast_click(session_item)
        time.sleep(0.15)


def restore_foreground_window(control, original_handle):
    if not control:
        return
    try:
        current_handle = get_native_window_handle(control)
        if original_handle and current_handle and original_handle != current_handle:
            return
        control.SetActive()
    except Exception:
        return


def activate_contact(wx, contact_name):
    automation_id = f"session_item_{contact_name}"
    session_item = wx.Control(
        ClassName="mmui::ChatSessionCell",
        AutomationId=automation_id,
        searchDepth=15,
    )

    if session_item.Exists(0, 0):
        if is_session_selected(session_item):
            return True
        fast_click(session_item)
        time.sleep(0.15)
        if is_session_selected(session_item):
            return True

    search_box = wx.EditControl(Name="搜索", searchDepth=20)
    if not search_box.Exists(0, 0):
        return False

    fast_click(search_box)
    time.sleep(0.1)
    search_box.SendKeys("{Ctrl}a")
    time.sleep(0.05)
    search_box.SendKeys("{Del}")
    time.sleep(0.05)

    if set_clipboard_text(contact_name):
        search_box.SendKeys("{Ctrl}v")
    else:
        search_box.SendKeys(contact_name.replace("{", "{{").replace("}", "}}"), interval=0.02)
    time.sleep(0.5)

    search_item = wx.Control(
        AutomationId=f"search_item_{contact_name}",
        searchDepth=20,
    )
    if search_item.Exists(0, 0):
        fast_click(search_item)
        time.sleep(0.4)
        return True

    search_box.SendKeys("{Enter}")
    time.sleep(0.8)
    return True


def send_text(wx, content):
    chat_edit = wx.EditControl(foundIndex=1)
    if not chat_edit.Exists(0, 0):
        return False

    fast_click(chat_edit)
    time.sleep(0.1)

    if not set_clipboard_text(content):
        return False

    chat_edit.SendKeys("{Ctrl}v")
    time.sleep(0.1)
    chat_edit.SendKeys("{Enter}")
    time.sleep(0.2)
    return True


def main():
    parser = argparse.ArgumentParser(description="本机微信自动化发送工具")
    parser.add_argument("--to", required=True, help="联系人显示名")
    parser.add_argument("--content", required=True, help="要发送的文本消息")
    parser.add_argument("--action", choices=["sendtext"], default="sendtext", help="当前仅支持 sendtext")
    args = parser.parse_args()

    original_foreground = get_foreground_control()
    original_handle = get_native_window_handle(original_foreground) if original_foreground else 0

    wx = get_wechat_window()
    if not wx:
      print("未找到微信窗口，请确认 PC 微信已启动并登录")
      sys.exit(1)

    original_session_name = get_selected_session_name(wx)

    wx.SetActive()
    time.sleep(0.5)

    if not activate_contact(wx, args.to):
        print(f"无法定位联系人: {args.to}")
        sys.exit(1)

    if not send_text(wx, args.content):
        print("发送失败，未找到聊天输入框或剪贴板不可用")
        sys.exit(1)

    if original_session_name and original_session_name != args.to:
        restore_contact(wx, original_session_name)

    restore_foreground_window(original_foreground, original_handle)

    print("发送成功")
    sys.exit(0)


if __name__ == "__main__":
    main()
