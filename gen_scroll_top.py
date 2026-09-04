from PIL import Image, ImageDraw

size = 200
img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)

# Light gray circle background
draw.ellipse([10, 10, size-10, size-10], fill=(225, 225, 225, 255))

color = (50, 50, 50, 255)
line_width = 4
cx = size // 2

# Vertical shaft: from bottom (y=170) up to just below arrowhead (y=58)
draw.line([(cx, 170), (cx, 58)], fill=color, width=line_width)

# Arrowhead: V shape connecting at top of shaft (y=52)
draw.line([(cx - 20, 78), (cx, 52)], fill=color, width=line_width)
draw.line([(cx + 20, 78), (cx, 52)], fill=color, width=line_width)

# Horizontal bar near top of shaft, just below arrowhead (y=68)
draw.line([(cx - 24, 68), (cx + 24, 68)], fill=color, width=line_width)

img.save(r'c:\Users\Administrator\Desktop\校园小程序第二版\assets\icons\scroll-top.png')
print('Icon generated successfully')
