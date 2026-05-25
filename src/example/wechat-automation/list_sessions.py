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
    if value is None:
        return ""
    try:
        return str(value)
    except Exception:
        return ""


def main():
    wx = get_wechat_window()
    if not wx:
        print("未找到微信窗口，请确认 PC 微信已启动并登录")
        sys.exit(1)

    wx.SetActive()
    time.sleep(0.5)

    sessions = wx.GetChildren()
    results = []

    def walk(control, depth=0):
        if depth > 6:
            return
        try:
            class_name = safe_str(control.ClassName)
            automation_id = safe_str(control.AutomationId)
            name = safe_str(control.Name)
        except Exception:
            class_name = ""
            automation_id = ""
            name = ""

        if class_name == "mmui::ChatSessionCell" or automation_id.startswith("session_item_"):
            results.append(
                {
                    "name": name,
                    "automation_id": automation_id,
                    "class_name": class_name,
                }
            )

        try:
            for child in control.GetChildren():
                walk(child, depth + 1)
        except Exception:
            return

    for child in sessions:
        walk(child)

    seen = set()
    deduped = []
    for item in results:
        key = (item["automation_id"], item["name"], item["class_name"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    for idx, item in enumerate(deduped, start=1):
        print(
            f"{idx}. name={item['name']!r} automation_id={item['automation_id']!r} class_name={item['class_name']!r}"
        )


if __name__ == "__main__":
    main()
