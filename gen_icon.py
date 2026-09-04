from PIL import Image, ImageDraw

size = 200
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Light gray circle background
draw.ellipse([10, 10, size-10, size-10], fill=(225, 225, 225, 255))

# Dark gray color for arrow
color = (50, 50, 50, 255)
line_width = 4

# Arrow: vertical shaft from bottom to near top
# Arrowhead at top
# Horizontal bar near the top of the shaft

cx = size // 2  # 100
# Vertical shaft: from y=170 up to y=60
draw.line([(cx, 170), (cx, 60)], fill=color, width=line_width)

# Arrowhead: V shape at top
draw.line([(cx - 18, 80), (cx, 55)], fill=color, width=line_width)
draw.line([(cx + 18, 80), (cx, 55)], fill=color, width=line_width)

# Horizontal bar near top of shaft (at y=65)
draw.line([(cx - 22, 65), (cx + 22, 65)], fill=color, width=line_width)

img.save(r'c:\Users\Administrator\Desktop\校园小程序第二版\assets\icons\scroll-top.png')
print("Done")
