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


def walk(control, depth=0, max_depth=12, results=None):
    if results is None:
        results = []
    if depth > max_depth:
        return results

    try:
        automation_id = safe_str(control.AutomationId)
        if "session_item_" in automation_id:
            results.append(
                {
                    "depth": depth,
                    "name": safe_str(control.Name),
                    "class_name": safe_str(control.ClassName),
                    "automation_id": automation_id,
                    "control_type": safe_str(control.ControlTypeName),
                }
            )
    except Exception:
        pass

    try:
        for child in control.GetChildren():
            walk(child, depth + 1, max_depth, results)
    except Exception:
        return results

    return results


def main():
    wx = get_wechat_window()
    if not wx:
        print("未找到微信窗口，请确认 PC 微信已启动并登录")
        sys.exit(1)

    wx.SetActive()
    time.sleep(0.5)

    results = walk(wx)
    if not results:
        print("未找到任何 automation_id 包含 session_item_ 的控件")
        return

    for idx, item in enumerate(results, start=1):
        print(
            f"{idx}. depth={item['depth']} name={item['name']!r} class_name={item['class_name']!r} automation_id={item['automation_id']!r} control_type={item['control_type']!r}"
        )


if __name__ == "__main__":
    main()
