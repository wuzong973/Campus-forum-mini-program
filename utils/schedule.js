const COURSE_THEME_PRESETS = {
  theory: {
    key: "theory",
    label: "理论课",
    color: "#4A7AFF",
    soft: "rgba(74, 122, 255, 0.14)",
    border: "rgba(74, 122, 255, 0.22)",
  },
  practice: {
    key: "practice",
    label: "实训课",
    color: "#FA8C16",
    soft: "rgba(250, 140, 22, 0.16)",
    border: "rgba(250, 140, 22, 0.24)",
  },
  sports: {
    key: "sports",
    label: "体育课",
    color: "#52C41A",
    soft: "rgba(82, 196, 26, 0.16)",
    border: "rgba(82, 196, 26, 0.24)",
  },
  lab: {
    key: "lab",
    label: "实验课",
    color: "#722ED1",
    soft: "rgba(114, 46, 209, 0.14)",
    border: "rgba(114, 46, 209, 0.22)",
  },
  activity: {
    key: "activity",
    label: "活动",
    color: "#13C2C2",
    soft: "rgba(19, 194, 194, 0.15)",
    border: "rgba(19, 194, 194, 0.22)",
  },
  evening: {
    key: "evening",
    label: "晚课",
    color: "#EB2F96",
    soft: "rgba(235, 47, 150, 0.14)",
    border: "rgba(235, 47, 150, 0.22)",
  },
};

// 差异化颜色调色板：为每门不同课程分配专属颜色
const COURSE_COLOR_PALETTE = [
  {
    color: "#4A7AFF",
    soft: "rgba(74,122,255,0.18)",
    border: "rgba(74,122,255,0.28)",
    text: "#1a2a5e",
  },
  {
    color: "#FA8C16",
    soft: "rgba(250,140,22,0.18)",
    border: "rgba(250,140,22,0.28)",
    text: "#5c3400",
  },
  {
    color: "#52C41A",
    soft: "rgba(82,196,26,0.18)",
    border: "rgba(82,196,26,0.28)",
    text: "#1b4d00",
  },
  {
    color: "#722ED1",
    soft: "rgba(114,46,209,0.18)",
    border: "rgba(114,46,209,0.28)",
    text: "#2b0d5e",
  },
  {
    color: "#13C2C2",
    soft: "rgba(19,194,194,0.18)",
    border: "rgba(19,194,194,0.28)",
    text: "#004d4d",
  },
  {
    color: "#EB2F96",
    soft: "rgba(235,47,150,0.18)",
    border: "rgba(235,47,150,0.28)",
    text: "#5e0036",
  },
  {
    color: "#2F54EB",
    soft: "rgba(47,84,235,0.18)",
    border: "rgba(47,84,235,0.28)",
    text: "#0d1a5e",
  },
  {
    color: "#F5222D",
    soft: "rgba(245,34,45,0.18)",
    border: "rgba(245,34,45,0.28)",
    text: "#5e0000",
  },
  {
    color: "#FAAD14",
    soft: "rgba(250,173,20,0.18)",
    border: "rgba(250,173,20,0.28)",
    text: "#5c4000",
  },
  {
    color: "#7B61FF",
    soft: "rgba(123,97,255,0.18)",
    border: "rgba(123,97,255,0.28)",
    text: "#2b1a5e",
  },
  {
    color: "#36CFC9",
    soft: "rgba(54,207,201,0.18)",
    border: "rgba(54,207,201,0.28)",
    text: "#004d4a",
  },
  {
    color: "#FF7A45",
    soft: "rgba(255,122,69,0.18)",
    border: "rgba(255,122,69,0.28)",
    text: "#5e2200",
  },
];

// 为每门不同课程分配唯一颜色（按课程名称映射）
function buildCourseColorMap(courses) {
  const nameMap = {};
  let paletteIdx = 0;
  const result = {};
  courses.forEach((course) => {
    const key = String(course.id);
    if (result[key]) return;
    if (!nameMap[course.name]) {
      nameMap[course.name] =
        COURSE_COLOR_PALETTE[paletteIdx % COURSE_COLOR_PALETTE.length];
      paletteIdx++;
    }
    result[key] = nameMap[course.name];
  });
  return result;
}

// 从颜色生成浅色背景（用于时段格子同步显示）
function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substr(0, 2), 16),
    g: parseInt(h.substr(2, 2), 16),
    b: parseInt(h.substr(4, 2), 16),
  };
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function normalizeTime(value, fallback) {
  if (!value) return fallback;
  const raw = String(value).trim().replace("：", ":");
  const match = raw.match(/(\d{1,2})[:：](\d{2})/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const minute = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return pad2(hour) + ":" + pad2(minute);
}

function parseTimeMinutes(value) {
  const normalized = normalizeTime(value, "");
  if (!normalized) return 0;
  const parts = normalized.split(":").map(Number);
  return parts[0] * 60 + parts[1];
}

function inferCourseTheme(course) {
  const name =
    ((course && course.name) || "") + " " + ((course && course.location) || "");
  const text = name.toLowerCase();
  const startMinutes = parseTimeMinutes(course && course.startTime);

  if (/军体|体育|体能|操场|篮球|足球|羽毛球|跑步/.test(text)) {
    return COURSE_THEME_PRESETS.sports;
  }
  if (/实验|机房|实训|绘图|制图|工作坊|第四实训楼|b\d{3}/.test(text)) {
    return /实验/.test(text)
      ? COURSE_THEME_PRESETS.lab
      : COURSE_THEME_PRESETS.practice;
  }
  if (/班会|讲座|社团|活动|思政|晚训|自习/.test(text)) {
    return COURSE_THEME_PRESETS.activity;
  }
  if (startMinutes >= 18 * 60) {
    return COURSE_THEME_PRESETS.evening;
  }
  return COURSE_THEME_PRESETS.theory;
}

function normalizeCourse(course, index) {
  const theme = inferCourseTheme(course);
  return Object.assign({}, course, {
    id: course.id || Date.now() + (index || 0),
    name: course.name || "未命名课程",
    teacher: course.teacher || "",
    location: course.location || "",
    weekDay: Number(course.weekDay) || 1,
    startTime: normalizeTime(course.startTime, "08:30"),
    endTime: normalizeTime(course.endTime, "09:10"),
    startWeek: Number(course.startWeek) || 1,
    endWeek: Number(course.endWeek) || 16,
    weekType: course.weekType || "all",
    weekTypeLabel:
      course.weekType === "odd"
        ? "单周"
        : course.weekType === "even"
          ? "双周"
          : "",
    color: course.color || theme.color,
    themeKey: theme.key,
    themeLabel: theme.label,
    themeSoft: theme.soft,
    themeBorder: theme.border,
    // 差异化颜色字段（由 buildCourseColorMap 填充）
    courseColor: null,
    courseColorSoft: null,
    courseColorBorder: null,
    courseColorText: null,
  });
}

function getWeekDayText(weekDay) {
  const labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
  return labels[(Number(weekDay) || 1) - 1] || labels[0];
}

module.exports = {
  COURSE_THEME_PRESETS,
  COURSE_COLOR_PALETTE,
  normalizeTime,
  normalizeCourse,
  inferCourseTheme,
  getWeekDayText,
  buildCourseColorMap,
  hexToRgb,
};
