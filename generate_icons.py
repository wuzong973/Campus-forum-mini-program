"""
图标生成脚本 - 使用 Pillow 生成小程序所需的所有图标
"""
from PIL import Image, ImageDraw
import math
import os

OUTPUT_DIR = r"d:\校园小程序第二版\assets"
TABBAR_DIR = os.path.join(OUTPUT_DIR, "tabbar")
ICON_DIR = os.path.join(OUTPUT_DIR, "icons")
BANNER_DIR = os.path.join(OUTPUT_DIR, "banners")

# 确保目录存在
os.makedirs(TABBAR_DIR, exist_ok=True)
os.makedirs(ICON_DIR, exist_ok=True)
os.makedirs(BANNER_DIR, exist_ok=True)

# 颜色定义
COLOR_DEFAULT = "#969799"    # 默认灰色
COLOR_ACTIVE = "#4A7AFF"     # 激活蓝色
COLOR_WHITE = "#FFFFFF"

# ========== 绘制工具函数 ==========

def create_image(size, color="transparent"):
    """创建透明或纯色背景图片"""
    if color == "transparent":
        return Image.new("RGBA", size, (0, 0, 0, 0))
    return Image.new("RGBA", size, hex_to_rgba(color))

def hex_to_rgba(hex_color, alpha=255):
    """十六进制颜色转 RGBA"""
    hex_color = hex_color.lstrip('#')
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return (r, g, b, alpha)

def draw_rounded_rect(draw, xy, radius, fill=None, outline=None, width=1):
    """绘制圆角矩形"""
    x1, y1, x2, y2 = xy
    # 四个角的圆弧
    draw.arc([x1, y1, x1+2*radius, y1+2*radius], 180, 270, fill=outline, width=width)
    draw.arc([x2-2*radius, y1, x2, y1+2*radius], 270, 360, fill=outline, width=width)
    draw.arc([x2-2*radius, y2-2*radius, x2, y2], 0, 90, fill=outline, width=width)
    draw.arc([x1, y2-2*radius, x1+2*radius, y2], 90, 180, fill=outline, width=width)
    # 四条边
    draw.line([x1+radius, y1, x2-radius, y1], fill=outline, width=width)
    draw.line([x2, y1+radius, x2, y2-radius], fill=outline, width=width)
    draw.line([x1+radius, y2, x2-radius, y2], fill=outline, width=width)
    draw.line([x1, y1+radius, x1, y2-radius], fill=outline, width=width)
    # 填充
    if fill:
        for y in range(y1+radius, y2-radius+1):
            draw.line([x1, y, x2, y], fill=fill)
        draw.rectangle([x1+radius, y1, x2-radius, y2], fill=fill)

# ========== Tabbar 图标 (81x81) ==========

def draw_home_icon(color):
    """首页 - 房子图标（优化版）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 屋顶（三角形）
    draw.polygon([(40, 12), (12, 42), (68, 42)], fill=c)
    # 房体
    draw.rectangle([18, 42, 62, 68], fill=c)
    # 门
    draw.rectangle([32, 52, 48, 68], fill=hex_to_rgba(COLOR_WHITE))
    # 窗户
    draw.rectangle([22, 46, 30, 54], fill=hex_to_rgba(COLOR_WHITE))
    draw.rectangle([50, 46, 58, 54], fill=hex_to_rgba(COLOR_WHITE))
    return img

def draw_schedule_icon(color):
    """课程表 - 日历图标（优化版）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 外框
    draw.rounded_rectangle([12, 18, 68, 68], radius=4, outline=c, width=3)
    # 顶部横条
    draw.rectangle([12, 18, 68, 32], fill=c)
    # 网格
    draw.line([28, 32, 28, 68], fill=c, width=2)
    draw.line([42, 32, 42, 68], fill=c, width=2)
    draw.line([56, 32, 56, 68], fill=c, width=2)
    draw.line([12, 44, 68, 44], fill=c, width=2)
    draw.line([12, 56, 68, 56], fill=c, width=2)
    # 顶部挂钩
    draw.rectangle([24, 10, 28, 22], fill=c)
    draw.rectangle([52, 10, 56, 22], fill=c)
    return img

def draw_errand_icon(color):
    """代拿跑腿 - 包裹图标（优化版）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 盒子
    draw.rounded_rectangle([14, 26, 66, 68], radius=4, outline=c, width=3)
    # 盒盖线
    draw.line([14, 40, 66, 40], fill=c, width=3)
    # 十字
    draw.line([40, 26, 40, 68], fill=c, width=3)
    # 提手
    draw.arc([26, 12, 54, 30], 180, 0, fill=c, width=3)
    # 装饰点
    draw.ellipse([22, 48, 26, 52], fill=c)
    draw.ellipse([54, 48, 58, 52], fill=c)
    return img

def draw_user_icon(color):
    """我的 - 人物图标（优化版）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 头
    draw.ellipse([26, 12, 54, 40], fill=c)
    # 身体
    draw.ellipse([12, 42, 68, 78], fill=c)
    # 肩膀细节
    draw.arc([20, 42, 60, 70], 0, 180, fill=c, width=2)
    return img

# ========== 功能图标 (48x48) ==========

def draw_wallet_icon():
    """钱包图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F5A623")
    # 钱包主体
    draw.rounded_rectangle([6, 12, 42, 38], radius=4, fill=c)
    # 钱包盖
    draw.rounded_rectangle([6, 12, 42, 20], radius=4, fill=hex_to_rgba("#E8961F"))
    # 金币
    draw.ellipse([20, 22, 28, 30], fill=hex_to_rgba(COLOR_WHITE))
    draw.text((22, 23), "$", fill=c)
    return img

def draw_order_icon():
    """订单图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 剪贴板
    draw.rounded_rectangle([10, 8, 38, 40], radius=3, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([10, 8, 38, 40], radius=3, outline=c, width=2)
    # 夹子
    draw.rectangle([18, 4, 30, 12], fill=c)
    # 列表线
    draw.line([16, 20, 32, 20], fill=c, width=2)
    draw.line([16, 26, 32, 26], fill=c, width=2)
    draw.line([16, 32, 28, 32], fill=c, width=2)
    return img

def draw_post_icon():
    """帖子图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#52C41A")
    # 文档
    draw.rounded_rectangle([10, 6, 38, 42], radius=3, fill=hex_to_rgba("#F0F9EB"))
    draw.rounded_rectangle([10, 6, 38, 42], radius=3, outline=c, width=2)
    # 折角
    draw.polygon([(30, 6), (38, 6), (38, 14)], fill=c)
    # 文字线
    draw.line([16, 18, 32, 18], fill=c, width=2)
    draw.line([16, 24, 32, 24], fill=c, width=2)
    draw.line([16, 30, 26, 30], fill=c, width=2)
    return img

def draw_message_icon():
    """消息图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#13CE66")
    # 气泡
    draw.rounded_rectangle([6, 10, 42, 32], radius=6, fill=hex_to_rgba("#E8F8F0"))
    draw.rounded_rectangle([6, 10, 42, 32], radius=6, outline=c, width=2)
    # 尾巴
    draw.polygon([(14, 32), (14, 40), (22, 32)], fill=hex_to_rgba("#E8F8F0"))
    draw.line([14, 32, 22, 32], fill=c, width=2)
    # 点
    draw.ellipse([14, 18, 18, 22], fill=c)
    draw.ellipse([22, 18, 26, 22], fill=c)
    draw.ellipse([30, 18, 34, 22], fill=c)
    return img

def draw_security_icon():
    """账号安全图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 锁身
    draw.rounded_rectangle([12, 20, 36, 40], radius=4, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([12, 20, 36, 40], radius=4, outline=c, width=2)
    # 锁环
    draw.arc([16, 10, 32, 24], 180, 0, fill=c, width=3)
    # 钥匙孔
    draw.ellipse([21, 26, 27, 32], fill=c)
    draw.rectangle([23, 32, 25, 36], fill=c)
    return img

def draw_rules_icon():
    """社区规范图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F5A623")
    # 卷轴
    draw.rounded_rectangle([8, 8, 40, 40], radius=4, fill=hex_to_rgba("#FFF8E8"))
    draw.rounded_rectangle([8, 8, 40, 40], radius=4, outline=c, width=2)
    # 标题
    draw.rectangle([14, 14, 34, 18], fill=c)
    # 内容线
    draw.line([14, 24, 34, 24], fill=c, width=2)
    draw.line([14, 30, 34, 30], fill=c, width=2)
    draw.line([14, 36, 28, 36], fill=c, width=2)
    return img

def draw_service_icon():
    """联系客服图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 耳机
    draw.arc([10, 10, 38, 30], 180, 0, fill=c, width=3)
    draw.rounded_rectangle([6, 22, 14, 34], radius=3, fill=c)
    draw.rounded_rectangle([34, 22, 42, 34], radius=3, fill=c)
    # 麦克风
    draw.rounded_rectangle([20, 30, 28, 40], radius=4, fill=c)
    draw.line([24, 40, 24, 44], fill=c, width=2)
    draw.line([18, 44, 30, 44], fill=c, width=2)
    return img

def draw_feedback_icon():
    """用户反馈图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#909399")
    # 信封
    draw.rounded_rectangle([6, 12, 42, 36], radius=3, fill=hex_to_rgba("#F4F4F5"))
    draw.rounded_rectangle([6, 12, 42, 36], radius=3, outline=c, width=2)
    # 信封盖
    draw.line([6, 12, 24, 24], fill=c, width=2)
    draw.line([42, 12, 24, 24], fill=c, width=2)
    draw.line([6, 36, 24, 24], fill=c, width=2)
    draw.line([42, 36, 24, 24], fill=c, width=2)
    return img

def draw_help_icon():
    """常见问题图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F56C6C")
    # 圆圈
    draw.ellipse([8, 8, 40, 40], outline=c, width=3)
    # 问号
    draw.text((18, 12), "?", fill=c)
    return img

def draw_about_icon():
    """关于我们图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 信息圆圈
    draw.ellipse([8, 8, 40, 40], outline=c, width=3)
    # i
    draw.ellipse([22, 14, 26, 18], fill=c)
    draw.rectangle([22, 22, 26, 34], fill=c)
    return img

def draw_settings_icon():
    """设置齿轮图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#969799")
    # 齿轮外圈
    draw.ellipse([8, 8, 40, 40], outline=c, width=3)
    # 齿轮齿
    for i in range(8):
        angle = i * 45
        rad = math.radians(angle)
        x1 = 24 + 14 * math.cos(rad)
        y1 = 24 + 14 * math.sin(rad)
        x2 = 24 + 18 * math.cos(rad)
        y2 = 24 + 18 * math.sin(rad)
        draw.line([x1, y1, x2, y2], fill=c, width=3)
    # 中心圆
    draw.ellipse([18, 18, 30, 30], fill=c)
    return img

def draw_avatar_icon():
    """头像图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 圆形背景
    draw.ellipse([4, 4, 44, 44], fill=hex_to_rgba("#E8EEFF"))
    # 人物
    draw.ellipse([16, 12, 32, 28], fill=c)
    draw.ellipse([10, 30, 38, 46], fill=c)
    return img

def draw_nickname_icon():
    """昵称图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 编辑图标
    draw.rounded_rectangle([8, 12, 36, 36], radius=4, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([8, 12, 36, 36], radius=4, outline=c, width=2)
    # 铅笔
    draw.line([16, 28, 28, 16], fill=c, width=2)
    draw.line([28, 16, 32, 20], fill=c, width=2)
    draw.line([16, 28, 20, 32], fill=c, width=2)
    return img

def draw_gender_icon():
    """性别图标（男女合）"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 男
    draw.ellipse([8, 14, 20, 26], outline=c, width=2)
    draw.line([17, 17, 24, 10], fill=c, width=2)
    draw.line([24, 10, 20, 10], fill=c, width=2)
    draw.line([24, 10, 24, 14], fill=c, width=2)
    # 女
    draw.ellipse([28, 14, 40, 26], outline=hex_to_rgba("#FF6B9D"), width=2)
    draw.line([34, 26, 34, 34], fill=hex_to_rgba("#FF6B9D"), width=2)
    draw.line([30, 30, 38, 30], fill=hex_to_rgba("#FF6B9D"), width=2)
    draw.line([30, 34, 38, 34], fill=hex_to_rgba("#FF6B9D"), width=2)
    return img

def draw_gender_male_icon():
    """男性图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    draw.ellipse([10, 10, 34, 34], outline=c, width=3)
    draw.line([28, 16, 40, 6], fill=c, width=3)
    draw.line([34, 6, 40, 6], fill=c, width=3)
    draw.line([40, 6, 40, 12], fill=c, width=3)
    return img

def draw_gender_female_icon():
    """女性图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#FF6B9D")
    draw.ellipse([10, 6, 34, 30], outline=c, width=3)
    draw.line([22, 30, 22, 42], fill=c, width=3)
    draw.line([16, 36, 28, 36], fill=c, width=3)
    return img

def draw_school_icon():
    """学校图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 建筑
    draw.rectangle([10, 20, 38, 40], fill=hex_to_rgba("#E8EEFF"))
    draw.rectangle([10, 20, 38, 40], outline=c, width=2)
    # 屋顶
    draw.polygon([8, 20, 24, 8, 40, 20], fill=c)
    # 门
    draw.rectangle([20, 30, 28, 40], fill=c)
    # 窗户
    draw.rectangle([14, 24, 18, 28], fill=c)
    draw.rectangle([30, 24, 34, 28], fill=c)
    return img

def draw_campus_icon():
    """校区图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 地图标记
    draw.ellipse([14, 8, 34, 28], outline=c, width=3)
    draw.polygon([14, 24, 24, 40, 34, 24], fill=c)
    # 中心点
    draw.ellipse([20, 14, 28, 22], fill=c)
    return img

def draw_phone_icon():
    """手机图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 手机
    draw.rounded_rectangle([14, 6, 34, 42], radius=4, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([14, 6, 34, 42], radius=4, outline=c, width=2)
    # 屏幕
    draw.rectangle([17, 12, 31, 34], fill=c)
    # Home键
    draw.ellipse([21, 36, 27, 40], outline=c, width=2)
    return img

def draw_agreement_icon():
    """协议图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 文档
    draw.rounded_rectangle([10, 6, 38, 42], radius=3, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([10, 6, 38, 42], radius=3, outline=c, width=2)
    # 勾选
    draw.line([16, 24, 22, 30], fill=c, width=3)
    draw.line([22, 30, 32, 18], fill=c, width=3)
    return img

def draw_privacy_icon():
    """隐私图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 盾牌
    draw.polygon([24, 6, 38, 14, 38, 28, 24, 42, 10, 28, 10, 14], outline=c, width=3)
    # 锁
    draw.rounded_rectangle([18, 22, 30, 34], radius=3, fill=c)
    draw.arc([20, 16, 28, 24], 180, 0, fill=c, width=2)
    return img

def draw_version_icon():
    """版本图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#969799")
    # 标签
    draw.rounded_rectangle([8, 14, 40, 34], radius=4, fill=hex_to_rgba("#F4F4F5"))
    draw.rounded_rectangle([8, 14, 40, 34], radius=4, outline=c, width=2)
    # v
    draw.text((18, 18), "v", fill=c)
    return img

def draw_logout_icon():
    """退出登录图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F56C6C")
    # 门
    draw.rounded_rectangle([10, 10, 30, 38], radius=3, outline=c, width=2)
    # 箭头
    draw.line([32, 24, 42, 24], fill=c, width=3)
    draw.line([38, 18, 44, 24], fill=c, width=3)
    draw.line([38, 30, 44, 24], fill=c, width=3)
    return img

def draw_camera_icon():
    """相机图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(COLOR_WHITE)
    # 相机主体
    draw.rounded_rectangle([8, 14, 40, 36], radius=4, fill=c)
    # 镜头
    draw.ellipse([18, 18, 30, 30], fill=hex_to_rgba("#4A7AFF"))
    draw.ellipse([22, 22, 26, 26], fill=c)
    # 闪光灯
    draw.rectangle([32, 16, 36, 20], fill=hex_to_rgba("#4A7AFF"))
    # 顶部按钮
    draw.rectangle([14, 10, 18, 14], fill=c)
    return img

def draw_search_icon():
    """搜索图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#969799")
    # 放大镜圆环
    draw.ellipse([10, 10, 30, 30], outline=c, width=3)
    # 手柄
    draw.line([26, 26, 38, 38], fill=c, width=3)
    return img

def draw_notice_icon():
    """公告图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F5A623")
    # 喇叭主体
    draw.polygon([10, 18, 20, 18, 30, 10, 30, 38, 20, 30, 10, 30], fill=c)
    # 喇叭口
    draw.polygon([30, 10, 38, 6, 38, 42, 30, 38], fill=c)
    # 声波
    draw.arc([34, 14, 42, 22], 270, 90, fill=c, width=2)
    draw.arc([36, 18, 44, 30], 270, 90, fill=c, width=2)
    return img

def draw_location_icon():
    """定位图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 地图标记
    draw.ellipse([14, 8, 34, 28], outline=c, width=3)
    draw.polygon([14, 24, 24, 42, 34, 24], fill=c)
    # 中心点
    draw.ellipse([20, 14, 28, 22], fill=c)
    return img

def draw_menu_icon():
    """菜单图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    # 三条横线
    draw.line([10, 14, 38, 14], fill=c, width=3)
    draw.line([10, 24, 38, 24], fill=c, width=3)
    draw.line([10, 34, 38, 34], fill=c, width=3)
    return img

def draw_heart_icon(color="#F56C6C"):
    """心形图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 左半圆
    draw.ellipse([8, 12, 24, 28], fill=c)
    # 右半圆
    draw.ellipse([24, 12, 40, 28], fill=c)
    # 底部三角
    draw.polygon([(8, 20), (40, 20), (24, 40)], fill=c)
    return img

def draw_comment_icon():
    """评论图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 气泡
    draw.rounded_rectangle([6, 10, 42, 32], radius=6, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([6, 10, 42, 32], radius=6, outline=c, width=2)
    # 尾巴
    draw.polygon([(14, 32), (14, 40), (22, 32)], fill=hex_to_rgba("#E8EEFF"))
    draw.line([14, 32, 22, 32], fill=c, width=2)
    # 三个点
    draw.ellipse([14, 18, 18, 22], fill=c)
    draw.ellipse([22, 18, 26, 22], fill=c)
    draw.ellipse([30, 18, 34, 22], fill=c)
    return img

def draw_edit_icon():
    """编辑图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 铅笔主体
    draw.polygon([(12, 36), (36, 12), (40, 16), (16, 40)], fill=c)
    # 铅笔尖
    draw.polygon([(12, 36), (16, 40), (10, 42)], fill=hex_to_rgba("#323233"))
    # 铅笔顶部
    draw.rectangle([36, 8, 42, 14], fill=c)
    return img

def draw_clipboard_icon():
    """剪贴板图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    # 板子
    draw.rounded_rectangle([10, 8, 38, 42], radius=3, fill=hex_to_rgba("#E8EEFF"))
    draw.rounded_rectangle([10, 8, 38, 42], radius=3, outline=c, width=2)
    # 夹子
    draw.rectangle([18, 4, 30, 12], fill=c)
    # 列表线
    draw.line([16, 20, 32, 20], fill=c, width=2)
    draw.line([16, 26, 32, 26], fill=c, width=2)
    draw.line([16, 32, 28, 32], fill=c, width=2)
    return img

def draw_pin_icon():
    """图钉图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F56C6C")
    # 图钉头
    draw.ellipse([16, 8, 32, 24], fill=c)
    # 图钉针
    draw.line([24, 24, 24, 40], fill=c, width=3)
    # 针尖
    draw.polygon([(22, 38), (26, 38), (24, 44)], fill=c)
    return img

def draw_check_icon():
    """对勾图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#52C41A")
    # 圆圈
    draw.ellipse([8, 8, 40, 40], outline=c, width=3)
    # 对勾
    draw.line([14, 24, 20, 30], fill=c, width=3)
    draw.line([20, 30, 34, 16], fill=c, width=3)
    return img

def draw_cross_icon():
    """叉号图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#F56C6C")
    # 圆圈
    draw.ellipse([8, 8, 40, 40], outline=c, width=3)
    # 叉号
    draw.line([16, 16, 32, 32], fill=c, width=3)
    draw.line([32, 16, 16, 32], fill=c, width=3)
    return img

def draw_plus_icon():
    """加号图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    # 竖线
    draw.line([24, 10, 24, 38], fill=c, width=3)
    # 横线
    draw.line([10, 24, 38, 24], fill=c, width=3)
    return img

def draw_refresh_icon():
    """刷新图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    # 圆弧
    draw.arc([10, 10, 38, 38], 30, 330, fill=c, width=3)
    # 箭头
    draw.line([30, 10, 38, 10], fill=c, width=3)
    draw.line([38, 10, 38, 18], fill=c, width=3)
    return img

def draw_scroll_top_icon():
    """回到顶部图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    # 方框
    draw.rounded_rectangle([10, 10, 38, 38], radius=4, outline=c, width=3)
    # 向上箭头
    draw.line([24, 30, 24, 16], fill=c, width=3)
    draw.line([18, 22, 24, 16], fill=c, width=3)
    draw.line([30, 22, 24, 16], fill=c, width=3)
    # 底部横线
    draw.line([16, 30, 32, 30], fill=c, width=2)
    return img

def draw_share_icon():
    """分享/转发图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    # 箭头曲线
    draw.arc([10, 10, 38, 38], 180, 0, fill=c, width=3)
    # 箭头头部
    draw.line([30, 10, 38, 10], fill=c, width=3)
    draw.line([38, 10, 38, 18], fill=c, width=3)
    return img

def draw_errand_home_icon(color):
    """代拿跑腿-首页图标（房子轮廓）"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.polygon([(24, 8), (8, 24), (40, 24)], outline=c, width=2)
    draw.rectangle([12, 24, 36, 40], outline=c, width=2)
    draw.rectangle([20, 30, 28, 40], outline=c, width=2)
    return img

def draw_errand_publish_icon(color):
    """代拿跑腿-发布图标（加号圆圈）"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.ellipse([8, 8, 40, 40], outline=c, width=2)
    draw.line([24, 16, 24, 32], fill=c, width=2)
    draw.line([16, 24, 32, 24], fill=c, width=2)
    return img

def draw_errand_order_icon(color):
    """代拿跑腿-订单图标（人物轮廓）"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.ellipse([18, 10, 30, 22], outline=c, width=2)
    draw.ellipse([10, 26, 38, 44], outline=c, width=2)
    return img

def draw_home_tab_icon(color):
    """首页tabbar图标（房子轮廓，更精致）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.polygon([(40, 14), (14, 40), (66, 40)], outline=c, width=3)
    draw.rectangle([20, 40, 60, 66], outline=c, width=3)
    draw.rectangle([34, 50, 46, 66], outline=c, width=2)
    return img

def draw_schedule_tab_icon(color):
    """课程表tabbar图标（日历）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.rounded_rectangle([14, 16, 66, 66], radius=4, outline=c, width=3)
    draw.rectangle([14, 16, 66, 28], fill=c)
    draw.line([28, 28, 28, 66], fill=c, width=2)
    draw.line([42, 28, 42, 66], fill=c, width=2)
    draw.line([56, 28, 56, 66], fill=c, width=2)
    draw.line([14, 42, 66, 42], fill=c, width=2)
    draw.line([14, 54, 66, 54], fill=c, width=2)
    return img

def draw_errand_tab_icon(color):
    """代拿跑腿tabbar图标（跑步人物）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    # 头
    draw.ellipse([30, 12, 46, 28], outline=c, width=3)
    # 身体
    draw.line([38, 28, 30, 48], fill=c, width=3)
    # 手臂
    draw.line([38, 32, 52, 24], fill=c, width=3)
    draw.line([38, 32, 22, 38], fill=c, width=3)
    # 腿
    draw.line([30, 48, 18, 64], fill=c, width=3)
    draw.line([30, 48, 44, 64], fill=c, width=3)
    return img

def draw_empty_box_icon():
    """空状态盒子图标"""
    img = create_image((160, 120))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#C8C9CC")
    # 盒子主体
    draw.rounded_rectangle([30, 40, 130, 95], radius=6, outline=c, width=3)
    # 盒盖开口
    draw.arc([55, 40, 105, 65], 180, 0, fill=c, width=3)
    draw.line([30, 40, 55, 40], fill=c, width=3)
    draw.line([105, 40, 130, 40], fill=c, width=3)
    # 表情 - 眼睛
    draw.arc([55, 62, 67, 72], 0, 180, fill=c, width=2)
    draw.arc([93, 62, 105, 72], 0, 180, fill=c, width=2)
    # 表情 - 嘴巴
    draw.arc([70, 72, 90, 82], 0, 180, fill=c, width=2)
    # 装饰星星
    draw.line([20, 20, 26, 26], fill=c, width=2)
    draw.line([26, 20, 20, 26], fill=c, width=2)
    draw.line([134, 16, 140, 22], fill=c, width=2)
    draw.line([140, 16, 134, 22], fill=c, width=2)
    draw.line([120, 30, 126, 36], fill=c, width=2)
    draw.line([126, 30, 120, 36], fill=c, width=2)
    # 装饰圆圈
    draw.ellipse([72, 14, 82, 24], outline=c, width=2)
    draw.ellipse([100, 22, 106, 28], outline=c, width=2)
    return img

def draw_tag_list_icon():
    """列表标签图标"""
    img = create_image((24, 24))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    draw.line([4, 7, 20, 7], fill=c, width=2)
    draw.line([4, 12, 20, 12], fill=c, width=2)
    draw.line([4, 17, 14, 17], fill=c, width=2)
    return img

def draw_tag_clock_icon():
    """时钟标签图标"""
    img = create_image((24, 24))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    draw.ellipse([4, 4, 20, 20], outline=c, width=2)
    draw.line([12, 8, 12, 13], fill=c, width=2)
    draw.line([12, 13, 16, 13], fill=c, width=2)
    return img

def draw_tag_person_icon():
    """人物标签图标"""
    img = create_image((24, 24))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    draw.ellipse([8, 4, 16, 12], outline=c, width=2)
    draw.arc([4, 14, 20, 24], 0, 180, fill=c, width=2)
    return img

def draw_tag_house_icon():
    """房子标签图标"""
    img = create_image((24, 24))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#4A7AFF")
    draw.polygon([(12, 4), (4, 12), (20, 12)], outline=c, width=2)
    draw.rectangle([6, 12, 18, 20], outline=c, width=2)
    return img

def draw_subtab_home_icon(color):
    """子Tab-首页图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.polygon([(24, 8), (8, 24), (40, 24)], outline=c, width=2)
    draw.rectangle([12, 24, 36, 40], outline=c, width=2)
    draw.rectangle([20, 30, 28, 40], outline=c, width=2)
    return img

def draw_subtab_publish_icon(color):
    """子Tab-发布图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.line([24, 12, 24, 36], fill=c, width=3)
    draw.line([12, 24, 36, 24], fill=c, width=3)
    return img

def draw_subtab_order_icon(color):
    """子Tab-订单图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.ellipse([16, 8, 32, 24], outline=c, width=2)
    draw.arc([8, 26, 40, 44], 0, 180, fill=c, width=2)
    return img

def draw_nav_home_icon():
    """导航栏返回图标"""
    img = create_image((48, 48))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba("#323233")
    draw.polygon([(24, 10), (10, 24), (24, 38)], outline=c, width=3)
    draw.line([10, 24, 38, 24], fill=c, width=3)
    return img

def draw_user_tab_icon(color):
    """我的tabbar图标（人物轮廓）"""
    img = create_image((81, 81))
    draw = ImageDraw.Draw(img)
    c = hex_to_rgba(color)
    draw.ellipse([28, 14, 52, 38], outline=c, width=3)
    draw.arc([14, 40, 66, 78], 0, 180, fill=c, width=3)
    return img

# ========== 轮播图 (750x400) ==========

def blend_color(base_rgb, overlay_rgb, alpha):
    """手动混合颜色：base + overlay * alpha"""
    r = int(base_rgb[0] * (1 - alpha) + overlay_rgb[0] * alpha)
    g = int(base_rgb[1] * (1 - alpha) + overlay_rgb[1] * alpha)
    b = int(base_rgb[2] * (1 - alpha) + overlay_rgb[2] * alpha)
    return (r, g, b)

def draw_gradient(draw, width, height, color1, color2):
    """绘制垂直渐变背景"""
    r1, g1, b1 = int(color1[1:3], 16), int(color1[3:5], 16), int(color1[5:7], 16)
    r2, g2, b2 = int(color2[1:3], 16), int(color2[3:5], 16), int(color2[5:7], 16)
    for y in range(height):
        ratio = y / height
        r = int(r1 + (r2 - r1) * ratio)
        g = int(g1 + (g2 - g1) * ratio)
        b = int(b1 + (b2 - b1) * ratio)
        draw.line([0, y, width, y], fill=(r, g, b))

def draw_semi_white(draw, bbox, bg_color, alpha, shape="ellipse"):
    """在RGB画布上绘制半透明白色形状"""
    color = blend_color(bg_color, (255, 255, 255), alpha)
    if shape == "ellipse":
        draw.ellipse(bbox, fill=color)
    elif shape == "rounded_rect":
        draw.rounded_rectangle(bbox, radius=16, fill=color)

def draw_banner_schedule():
    """轮播图1 - 智能识别课程表（蓝色主题）"""
    img = Image.new("RGB", (750, 400))
    draw = ImageDraw.Draw(img)
    # 渐变背景 #4A7AFF -> #7B9BFF
    draw_gradient(draw, 750, 400, "#4A7AFF", "#7B9BFF")
    bg = (118, 155, 255)  # 底部渐变色的近似
    # 装饰大圆（半透明白色）
    draw_semi_white(draw, [520, -80, 780, 180], (74, 122, 255), 0.16)
    draw_semi_white(draw, [580, 60, 820, 320], (100, 140, 255), 0.10)
    draw_semi_white(draw, [-120, 180, 120, 420], (118, 155, 255), 0.08)
    # 装饰小圆点
    dots = [(80, 310), (170, 330), (260, 305), (350, 325), (440, 310), (530, 330), (620, 305), (710, 325)]
    for dx, dy in dots:
        c = blend_color(bg, (255, 255, 255), 0.31)
        draw.ellipse([dx, dy, dx + 10, dy + 10], fill=c)
    # 日历图标
    c1 = blend_color(bg, (255, 255, 255), 0.39)
    c2 = blend_color(bg, (255, 255, 255), 0.55)
    c3 = blend_color(bg, (255, 255, 255), 0.31)
    draw.rounded_rectangle([490, 100, 680, 290], radius=16, fill=c1)
    draw.rounded_rectangle([490, 100, 680, 145], radius=16, fill=c2)
    for row in range(3):
        for col in range(4):
            x = 505 + col * 42
            y = 160 + row * 38
            draw.rounded_rectangle([x, y, x + 32, y + 28], radius=5, fill=c3)
    ch = blend_color(bg, (255, 255, 255), 0.47)
    draw.rectangle([520, 80, 530, 105], fill=ch)
    draw.rectangle([640, 80, 650, 105], fill=ch)
    # 标题区域
    c_title_bg = blend_color(bg, (255, 255, 255), 0.16)
    c_title_bar = blend_color(bg, (255, 255, 255), 0.78)
    c_subtitle = blend_color(bg, (255, 255, 255), 0.47)
    c_btn = blend_color(bg, (255, 255, 255), 0.86)
    draw.rounded_rectangle([40, 90, 440, 310], radius=20, fill=c_title_bg)
    draw.rounded_rectangle([60, 110, 320, 150], radius=10, fill=c_title_bar)
    draw.rounded_rectangle([60, 170, 400, 200], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 215, 340, 245], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 260, 220, 300], radius=20, fill=c_btn)
    draw.rounded_rectangle([80, 275, 200, 285], radius=5, fill=(74, 122, 255))
    return img

def draw_banner_errand():
    """轮播图2 - 代拿跑腿（橙色主题）"""
    img = Image.new("RGB", (750, 400))
    draw = ImageDraw.Draw(img)
    draw_gradient(draw, 750, 400, "#FF6B6B", "#FF8E53")
    bg = (255, 142, 83)
    # 装饰
    draw_semi_white(draw, [-80, 80, 160, 320], (255, 107, 107), 0.12)
    draw_semi_white(draw, [580, 30, 800, 260], (255, 125, 95), 0.14)
    # 包裹图标
    c_box = blend_color(bg, (255, 255, 255), 0.35)
    c_line = blend_color(bg, (255, 255, 255), 0.51)
    c_handle = blend_color(bg, (255, 255, 255), 0.47)
    draw.rounded_rectangle([510, 120, 670, 270], radius=12, fill=c_box)
    draw.line([510, 175, 670, 175], fill=c_line, width=4)
    draw.line([590, 120, 590, 270], fill=c_line, width=4)
    draw.arc([550, 90, 630, 130], 180, 0, fill=c_handle, width=4)
    # 标题区域
    c_title_bg = blend_color(bg, (255, 255, 255), 0.16)
    c_title_bar = blend_color(bg, (255, 255, 255), 0.78)
    c_subtitle = blend_color(bg, (255, 255, 255), 0.47)
    c_btn = blend_color(bg, (255, 255, 255), 0.86)
    draw.rounded_rectangle([40, 90, 440, 310], radius=20, fill=c_title_bg)
    draw.rounded_rectangle([60, 110, 340, 150], radius=10, fill=c_title_bar)
    draw.rounded_rectangle([60, 170, 400, 200], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 215, 300, 245], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 260, 220, 300], radius=20, fill=c_btn)
    draw.rounded_rectangle([80, 275, 200, 285], radius=5, fill=(255, 107, 107))
    return img

def draw_banner_community():
    """轮播图3 - 校园社区（绿色主题）"""
    img = Image.new("RGB", (750, 400))
    draw = ImageDraw.Draw(img)
    draw_gradient(draw, 750, 400, "#52C41A", "#73D13D")
    bg = (115, 209, 61)
    # 装饰
    draw_semi_white(draw, [530, -50, 760, 180], (82, 196, 26), 0.12)
    draw_semi_white(draw, [-100, 230, 130, 460], (115, 209, 61), 0.08)
    # 对话气泡图标
    c_bubble = blend_color(bg, (255, 255, 255), 0.35)
    draw.rounded_rectangle([510, 130, 660, 240], radius=24, fill=c_bubble)
    draw.polygon([(540, 240), (540, 275), (580, 240)], fill=c_bubble)
    draw.ellipse([540, 170, 555, 185], fill=(82, 196, 26))
    draw.ellipse([565, 170, 580, 185], fill=(82, 196, 26))
    draw.ellipse([590, 170, 605, 185], fill=(82, 196, 26))
    # 标题区域
    c_title_bg = blend_color(bg, (255, 255, 255), 0.16)
    c_title_bar = blend_color(bg, (255, 255, 255), 0.78)
    c_subtitle = blend_color(bg, (255, 255, 255), 0.47)
    c_btn = blend_color(bg, (255, 255, 255), 0.86)
    draw.rounded_rectangle([40, 90, 440, 310], radius=20, fill=c_title_bg)
    draw.rounded_rectangle([60, 110, 340, 150], radius=10, fill=c_title_bar)
    draw.rounded_rectangle([60, 170, 400, 200], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 215, 300, 245], radius=8, fill=c_subtitle)
    draw.rounded_rectangle([60, 260, 220, 300], radius=20, fill=c_btn)
    draw.rounded_rectangle([80, 275, 200, 285], radius=5, fill=(82, 196, 26))
    return img

# ========== 生成所有图标 ==========

def generate_icons():
    """生成所有图标"""
    print("Generating icons...")
    
    # Tabbar 图标
    tabbar_icons = {
        "home.png": draw_home_icon(COLOR_DEFAULT),
        "home-active.png": draw_home_icon(COLOR_ACTIVE),
        "schedule.png": draw_schedule_icon(COLOR_DEFAULT),
        "schedule-active.png": draw_schedule_icon(COLOR_ACTIVE),
        "errand.png": draw_errand_icon(COLOR_DEFAULT),
        "errand-active.png": draw_errand_icon(COLOR_ACTIVE),
        "user.png": draw_user_icon(COLOR_DEFAULT),
        "user-active.png": draw_user_icon(COLOR_ACTIVE),
    }
    
    for name, img in tabbar_icons.items():
        path = os.path.join(TABBAR_DIR, name)
        img.save(path, "PNG")
        print(f"[OK] Tabbar: {name}")
    
    # 功能图标
    func_icons = {
        "wallet.png": draw_wallet_icon(),
        "order.png": draw_order_icon(),
        "post.png": draw_post_icon(),
        "message.png": draw_message_icon(),
        "security.png": draw_security_icon(),
        "rules.png": draw_rules_icon(),
        "service.png": draw_service_icon(),
        "feedback.png": draw_feedback_icon(),
        "help.png": draw_help_icon(),
        "about.png": draw_about_icon(),
        "settings.png": draw_settings_icon(),
        "avatar.png": draw_avatar_icon(),
        "nickname.png": draw_nickname_icon(),
        "gender.png": draw_gender_icon(),
        "gender-male.png": draw_gender_male_icon(),
        "gender-female.png": draw_gender_female_icon(),
        "school.png": draw_school_icon(),
        "campus.png": draw_campus_icon(),
        "phone.png": draw_phone_icon(),
        "agreement.png": draw_agreement_icon(),
        "privacy.png": draw_privacy_icon(),
        "version.png": draw_version_icon(),
        "logout.png": draw_logout_icon(),
        "camera.png": draw_camera_icon(),
        "search.png": draw_search_icon(),
        "notice.png": draw_notice_icon(),
        "location.png": draw_location_icon(),
        "menu.png": draw_menu_icon(),
        "heart.png": draw_heart_icon("#F56C6C"),
        "heart-outline.png": draw_heart_icon("#C8C9CC"),
        "comment.png": draw_comment_icon(),
        "edit.png": draw_edit_icon(),
        "clipboard.png": draw_clipboard_icon(),
        "pin.png": draw_pin_icon(),
        "check.png": draw_check_icon(),
        "cross.png": draw_cross_icon(),
        "plus.png": draw_plus_icon(),
        "refresh.png": draw_refresh_icon(),
        "scroll-top.png": draw_scroll_top_icon(),
        "share.png": draw_share_icon(),
        "school-logo.png": draw_school_icon(),
        "errand-home.png": draw_errand_home_icon("#969799"),
        "errand-home-active.png": draw_errand_home_icon("#4A7AFF"),
        "errand-publish.png": draw_errand_publish_icon("#969799"),
        "errand-publish-active.png": draw_errand_publish_icon("#4A7AFF"),
        "errand-order.png": draw_errand_order_icon("#969799"),
        "errand-order-active.png": draw_errand_order_icon("#4A7AFF"),
        "empty-box.png": draw_empty_box_icon(),
        "tag-list.png": draw_tag_list_icon(),
        "tag-clock.png": draw_tag_clock_icon(),
        "tag-person.png": draw_tag_person_icon(),
        "tag-house.png": draw_tag_house_icon(),
        "subtab-home.png": draw_subtab_home_icon("#969799"),
        "subtab-home-active.png": draw_subtab_home_icon("#4A7AFF"),
        "subtab-publish.png": draw_subtab_publish_icon("#969799"),
        "subtab-publish-active.png": draw_subtab_publish_icon("#4A7AFF"),
        "subtab-order.png": draw_subtab_order_icon("#969799"),
        "subtab-order-active.png": draw_subtab_order_icon("#4A7AFF"),
        "nav-home.png": draw_nav_home_icon(),
    }
    
    for name, img in func_icons.items():
        path = os.path.join(ICON_DIR, name)
        img.save(path, "PNG")
        print(f"[OK] Icon: {name}")
    
    # 轮播图
    banner_imgs = {
        "banner-schedule.png": draw_banner_schedule(),
        "banner-errand.png": draw_banner_errand(),
        "banner-community.png": draw_banner_community(),
    }
    
    for name, img in banner_imgs.items():
        path = os.path.join(BANNER_DIR, name)
        img.save(path, "PNG")
        print(f"[OK] Banner: {name}")
    
    print(f"\n[OK] All assets generated!")
    print(f"  Tabbar: {TABBAR_DIR}")
    print(f"  Icons: {ICON_DIR}")
    print(f"  Banners: {BANNER_DIR}")

if __name__ == "__main__":
    generate_icons()
