import sys
import time

try:
    import uiautomation as auto
except ImportError as exc:
    print(f"缺少依赖 uiautomation: {exc}")
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


def safe_str(value):
    try:
        return "" if value is None else str(value)
    except Exception:
        return ""


def walk(control, depth=0, max_depth=7):
    indent = "  " * depth
    print(
        f"{indent}- Name={safe_str(control.Name)!r} ClassName={safe_str(control.ClassName)!r} AutomationId={safe_str(control.AutomationId)!r} ControlType={safe_str(control.ControlTypeName)!r}"
    )
    if depth >= max_depth:
        return
    try:
        for child in control.GetChildren():
            walk(child, depth + 1, max_depth)
    except Exception:
        return


def main():
    wx = get_wechat_window()
    if not wx:
        print("未找到微信窗口，请确认 PC 微信已启动并登录")
        sys.exit(1)

    wx.SetActive()
    time.sleep(0.5)
    walk(wx, 0, 7)


if __name__ == "__main__":
    main()
