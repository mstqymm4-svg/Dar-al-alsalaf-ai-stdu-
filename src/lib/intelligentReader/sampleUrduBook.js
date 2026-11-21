/**
 * DAR AL TAWHID — Authentic Multilingual Urdu & Arabic Book Generator
 * ("كيف تنقذ نفسك من ورطة الوسوسة؟ — وسوسے کے جال سے اپنے آپ کو کیسے بچائیں؟")
 *
 * Provides:
 * 1. Complete 5-page scholarly Urdu (Nastaliq) + Arabic + Quran + Hadith structured book
 * 2. Real valid multi-page PDF ArrayBuffer generator (renders high-DPI Nastaliq/Arabic pages into a standard PDF 1.4 binary)
 *    so PDF.js renders every page authentically with zero external network dependency.
 */

export const WASWASA_BOOK_ID = "book_waswasa_urdu_intelligent";
export const WASWASA_PDF_URL = "daraltawhid://books/waswasa-urdu-intelligent.pdf";

export const WASWASA_STRUCTURED_PAGES = [
  {
    pageNumber: 1,
    title: "صفحہ ١: مقدمہ — وسوسہ کی حقیقت اور اسلامی نقطۂ نظر",
    blocks: [
      {
        blockType: "heading",
        language: "ur",
        originalText: "کیف تنقذ نفسک من ورطۃ الوسوسۃ؟ — وسوسے کے جال سے نجات کا نبوی منہج",
        cleanedPronunciationText:
          "کیف تنقذ نفسک من ورطۃ الوسوسۃ؟ وسوسے کے جال سے نجات کا نبوی منہج۔",
        box2d: [70, 90, 150, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "الحمد للہ رب العالمین۔ وسوسہ شیطان کا ایک کمزور مگر خطرناک ہتھیار ہے جس کے ذریعے وہ مومن کے دل میں عبادت، طہارت، عقیدہ اور روزمرہ زندگی کے بارے میں بے جا شکوک و شبہات پیدا کرتا ہے۔",
        cleanedPronunciationText:
          "الحمد للہ رب العالمین۔ وسوسہ شیطان کا ایک کمزور مگر خطرناک ہتھیار ہے جس کے ذریعے وہ مومن کے دل میں عبادت، طہارت، عقیدہ اور روزمرہ زندگی کے بارے میں بے جا شکوک و شبہات پیدا کرتا ہے۔",
        box2d: [180, 80, 320, 920],
      },
      {
        blockType: "quran",
        language: "ar",
        surahNumber: 114,
        ayahNumber: 4,
        originalText: "﴿مِن شَرِّ الْوَسْوَاسِ الْخَنَّاسِ﴾",
        cleanedPronunciationText: "من شر الوسواس الخناس",
        box2d: [350, 120, 440, 880],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "امام ابن قیم رحمہ اللہ فرماتے ہیں کہ خناس کا معنی وہ شیطان ہے جو اللہ کے ذکر کے وقت پیچھے ہٹ جاتا ہے اور جب انسان غافل ہوتا ہے تو دوبارہ دل میں وسوسے ڈالنے لگتا ہے۔",
        cleanedPronunciationText:
          "امام ابن قیم رحمہ اللہ فرماتے ہیں کہ خناس کا معنی وہ شیطان ہے جو اللہ کے ذکر کے وقت پیچھے ہٹ جاتا ہے اور جب انسان غافل ہوتا ہے تو دوبارہ دل میں وسوسے ڈالنے لگتا ہے۔",
        box2d: [470, 80, 620, 920],
      },
      {
        blockType: "hadith",
        language: "ar",
        originalText:
          "قال رسول الله ﷺ: «إن الشيطان واضع خطمه على قلب ابن آدم، فإن ذكر الله خنس، وإن نسي التقم قلبه».",
        cleanedPronunciationText:
          "قال رسول الله صلى الله عليه وسلم: إن الشيطان واضع خطمه على قلب ابن آدم، فإن ذكر الله خنس، وإن نسي التقم قلبه.",
        box2d: [650, 90, 770, 910],
      },
      {
        blockType: "footnote",
        language: "ur",
        originalText:
          "حاشیہ (1): إغاثة اللهفان من مصايد الشيطان للإمام ابن قيم الجوزية، الباب الأول في حقيقة الوسوسة.",
        cleanedPronunciationText:
          "حاشیہ: إغاثة اللهفان من مصايد الشيطان للإمام ابن قيم الجوزية، الباب الأول في حقيقة الوسوسة۔",
        box2d: [840, 90, 910, 910],
      },
    ],
  },
  {
    pageNumber: 2,
    title: "صفحہ ٢: عقیدہ اور ایمان میں آنے والے وساوس کا شرعی علاج",
    blocks: [
      {
        blockType: "heading",
        language: "ur",
        originalText: "باب اول: ایمانی وساوس اور صحابۂ کرام رضی اللہ عنہم کا طرزِ عمل",
        cleanedPronunciationText:
          "باب اول: ایمانی وساوس اور صحابۂ کرام رضی اللہ عنہم کا طرز عمل۔",
        box2d: [70, 90, 150, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "بعض اوقات مومن کے ذہن میں ایسے خیالات آتے ہیں جنہیں زبان پر لانا بھی وہ گناہ سمجھتا ہے۔ یہ پریشانی اور خوف اس بات کی روشن دلیل ہے کہ اس کے دل میں خالص ایمان موجود ہے۔",
        cleanedPronunciationText:
          "بعض اوقات مومن کے ذہن میں ایسے خیالات آتے ہیں جنہیں زبان پر لانا بھی وہ گناہ سمجھتا ہے۔ یہ پریشانی اور خوف اس بات کی روشن دلیل ہے کہ اس کے دل میں خالص ایمان موجود ہے۔",
        box2d: [180, 80, 320, 920],
      },
      {
        blockType: "hadith",
        language: "ar",
        originalText:
          "عن أبي هريرة رضي الله عنه قال: جاء ناس من أصحاب النبي ﷺ فسألوه: إنا نجد في أنفسنا ما يتعاظم أحدنا أن يتكلم به، قال: «أوقد وجدتموه؟» قالوا: نعم، قال: «ذاك صريح الإيمان». رواه مسلم.",
        cleanedPronunciationText:
          "عن أبي هريرة رضي الله عنه قال: جاء ناس من أصحاب النبي صلى الله عليه وسلم فسألوه: إنا نجد في أنفسنا ما يتعاظم أحدنا أن يتكلم به، قال: أوقد وجدتموه؟ قالوا: نعم، قال: ذاك صريح الإيمان. رواه مسلم.",
        box2d: [350, 85, 510, 915],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "جب ایسا وسوسہ آئے تو نبی کریم ﷺ نے تین عملی ہدایات عطا فرمائی ہیں: فواً اللہ کی پناہ مانگنا، اس خیال کے سلسلے کو وہیں روک دینا، اور یہ کہنا کہ میں اللہ اور اس کے رسولوں پر ایمان لایا۔",
        cleanedPronunciationText:
          "جب ایسا وسوسہ آئے تو نبی کریم صلی اللہ علیہ وسلم نے تین عملی ہدایات عطا فرمائی ہیں: فوراً اللہ کی پناہ مانگنا، اس خیال کے سلسلے کو وہیں روک دینا، اور یہ کہنا کہ میں اللہ اور اس کے رسولوں پر ایمان لایا۔",
        box2d: [540, 80, 690, 920],
      },
      {
        blockType: "quran",
        language: "ar",
        surahNumber: 7,
        ayahNumber: 200,
        originalText: "﴿وَإِمَّا يَنزَغَنَّكَ مِنَ الشَّيْطَانِ نَزْغٌ فَاسْتَعِذْ بِاللَّهِ إِنَّهُ سَمِيعٌ عَلِيمٌ﴾",
        cleanedPronunciationText:
          "وإما ينزغنك من الشيطان نزغ فاستعذ بالله إنه سميع عليم",
        box2d: [720, 100, 820, 900],
      },
    ],
  },
  {
    pageNumber: 3,
    title: "صفحہ ٣: وضو، طہارت اور نماز میں وسوسے کا سدِ باب",
    blocks: [
      {
        blockType: "heading",
        language: "ur",
        originalText: "باب دوم: طہارت اور نماز میں شک اور تکرار سے بچاؤ کے فقہی قواعد",
        cleanedPronunciationText:
          "باب دوم: طہارت اور نماز میں شک اور تکرار سے بچاؤ کے فقہی قواعد۔",
        box2d: [70, 90, 150, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "طہارت اور وضو میں بار بار پانی بہانا اور اعضائے وضو کو تین مرتبہ سے زیادہ دھونا سنت کے خلاف ہے اور اس سے وسوسے کی بیماری مزید بڑھتی ہے۔ علمائے اسلام نے اس کے لیے ایک عظیم قاعدہ مقرر فرمایا ہے:",
        cleanedPronunciationText:
          "طہارت اور وضو میں بار بار پانی بہانا اور اعضائے وضو کو تین مرتبہ سے زیادہ دھونا سنت کے خلاف ہے اور اس سے وسوسے کی بیماری مزید بڑھتی ہے۔ علمائے اسلام نے اس کے لیے ایک عظیم قاعدہ مقرر فرمایا ہے:",
        box2d: [180, 80, 330, 920],
      },
      {
        blockType: "arabic_quote",
        language: "ar",
        originalText:
          "القاعدة الفقهية الكبرى: «اليقين لا يزول بالشك، وكثرة الشكوك لا يُلتفت إليها».",
        cleanedPronunciationText:
          "القاعدة الفقهية الكبرى: اليقين لا يزول بالشك، وكثرة الشكوك لا يلتفت إليها.",
        box2d: [360, 100, 460, 900],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "یعنی جب آپ کو وضو یا طہارت کا یقین ہو تو محض وہم یا شک کی بنا پر وضو نہیں ٹوٹتا۔ وسوسے کے مریض پر لازم ہے کہ وہ شک کی طرف بالکل توجہ نہ دے اور اپنی عبادت کو مکمل کرے۔",
        cleanedPronunciationText:
          "یعنی جب آپ کو وضو یا طہارت کا یقین ہو تو محض وہم یا شک کی بنا پر وضو نہیں ٹوٹتا۔ وسوسے کے مریض پر لازم ہے کہ وہ شک کی طرف بالکل توجہ نہ دے اور اپنی عبادت کو مکمل کرے۔",
        box2d: [490, 80, 640, 920],
      },
      {
        blockType: "quran",
        language: "ar",
        surahNumber: 2,
        ayahNumber: 286,
        originalText: "﴿لَا يُكَلِّفُ اللَّهُ نَفْسًا إِلَّا وُسْعَهَا﴾",
        cleanedPronunciationText: "لا يكلف الله نفسا إلا وسعها",
        box2d: [670, 120, 770, 880],
      },
    ],
  },
  {
    pageNumber: 4,
    title: "صفحہ ٤: ذکرِ الٰہی اور قرآنی تعوذات کے ذریعے قلبی سکون",
    blocks: [
      {
        blockType: "heading",
        language: "ur",
        originalText: "باب سوم: ذکرِ الٰہی اور مسنون دعاؤں کا حصار",
        cleanedPronunciationText: "باب سوم: ذکر الٰہی اور مسنون دعاؤں کا حصار۔",
        box2d: [70, 90, 150, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "دل کا حقیقی اطمینان اور پریشانیوں سے نجات صرف اللہ تعالیٰ کی یاد اور صبح و شام کے مسنون اذکار کی پابندی میں ہے۔ ذکرِ الٰہی دل کے گرد ایک مضبوط قلعہ بنا دیتا ہے۔",
        cleanedPronunciationText:
          "دل کا حقیقی اطمینان اور پریشانیوں سے نجات صرف اللہ تعالیٰ کی یاد اور صبح و شام کے مسنون اذکار کی پابندی میں ہے۔ ذکر الٰہی دل کے گرد ایک مضبوط قلعہ بنا دیتا ہے۔",
        box2d: [180, 80, 320, 920],
      },
      {
        blockType: "quran",
        language: "ar",
        surahNumber: 13,
        ayahNumber: 28,
        originalText: "﴿أَلَا بِذِكْرِ اللَّهِ تَطْمَئِنُّ الْقُلُوبُ﴾",
        cleanedPronunciationText: "ألا بذكر الله تطمئن القلوب",
        box2d: [350, 120, 440, 880],
      },
      {
        blockType: "dua",
        language: "ar",
        originalText:
          "الدعاء النبوي لدفع الوسوسة والهم: «اللَّهُمَّ إِنِّي أَعُوذُ بِكَ مِنَ الْهَمِّ وَالْحَزَنِ، وَأَعُوذُ بِكَ مِنَ الْعَجْزِ وَالْكَسَلِ».",
        cleanedPronunciationText:
          "الدعاء النبوي لدفع الوسوسة والهم: اللهم إني أعوذ بك من الهم والحزن، وأعوذ بك من العجز والكسل.",
        box2d: [470, 90, 590, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "سورۃ الفلق، سورۃ الناس اور آیت الکرسی کی تلاوت سونے سے پہلے اور ہر فرض نماز کے بعد کرنے سے انسان شیطانی وساوس سے محفوظ رہتا ہے۔",
        cleanedPronunciationText:
          "سورۃ الفلق، سورۃ الناس اور آیت الکرسی کی تلاوت سونے سے پہلے اور ہر فرض نماز کے بعد کرنے سے انسان شیطانی وساوس سے محفوظ رہتا ہے۔",
        box2d: [620, 80, 760, 920],
      },
    ],
  },
  {
    pageNumber: 5,
    title: "صفحہ ٥: خلاصہ اور عملی پروگرام برائے کامل شفا",
    blocks: [
      {
        blockType: "heading",
        language: "ur",
        originalText: "خاتمۃ الکتاب: وسوسے سے مکمل نجات کے پانچ سنہری اصول",
        cleanedPronunciationText:
          "خاتمۃ الکتاب: وسوسے سے مکمل نجات کے پانچ سنہری اصول۔",
        box2d: [70, 90, 150, 910],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "پہلا اصول: وسوسے کے ساتھ کبھی بحث نہ کریں بلکہ اسے مکمل طور پر نظر انداز کریں کیونکہ شیطان توجہ پانے سے طاقتور ہوتا ہے اور اعراض کرنے سے کمزور پڑ جاتا ہے۔",
        cleanedPronunciationText:
          "پہلا اصول: وسوسے کے ساتھ کبھی بحث نہ کریں بلکہ اسے مکمل طور پر نظر انداز کریں کیونکہ شیطان توجہ پانے سے طاقتور ہوتا ہے اور اعراض کرنے سے کمزور پڑ جاتا ہے۔",
        box2d: [180, 80, 320, 920],
      },
      {
        blockType: "quran",
        language: "ar",
        surahNumber: 23,
        ayahNumber: 97,
        originalText: "﴿وَقُل رَّبِّ أَعُوذُ بِكَ مِنْ هَمَزَاتِ الشَّيَاطِينِ﴾",
        cleanedPronunciationText: "وقل رب أعوذ بك من همزات الشياطين",
        box2d: [350, 110, 440, 890],
      },
      {
        blockType: "urdu_body",
        language: "ur",
        originalText:
          "دوسرا اصول: علمِ شرعی حاصل کریں اور نیک صحبت اختیار کریں۔ تیسرا اصول: اپنے اوقات کو مفید علمی اور عملی کاموں میں مشغول رکھیں تاکہ ذہن کو خالی پن کا شکار نہ ہونا پڑے۔",
        cleanedPronunciationText:
          "دوسرا اصول: علم شرعی حاصل کریں اور نیک صحبت اختیار کریں۔ تیسرا اصول: اپنے اوقات کو مفید علمی اور عملی کاموں میں مشغول رکھیں تاکہ ذہن کو خالی پن کا شکار نہ ہونا پڑے۔",
        box2d: [470, 80, 620, 920],
      },
      {
        blockType: "arabic_quote",
        language: "ar",
        originalText:
          "وصلى الله وسلم على نبينا محمد وعلى آله وصحبه أجمعين، والحمد لله رب العالمين.",
        cleanedPronunciationText:
          "وصلى الله وسلم على نبينا محمد وعلى آله وصحبه أجمعين، والحمد لله رب العالمين.",
        box2d: [660, 100, 760, 900],
      },
    ],
  },
];

export const WASWASA_BOOK_METADATA = {
  id: WASWASA_BOOK_ID,
  title: "كيف تنقذ نفسك من ورطة الوسوسة؟ (اردو • عربي)",
  author: "دار التوحيد — القسم العلمي والأردي",
  category: "العقيدة والتزكية",
  language: "الأردية",
  page_count: 5,
  rating: 5,
  is_featured: true,
  pdf_url: WASWASA_PDF_URL,
  cover_image:
    "https://media.base44.com/images/public/69c8e483a69a0d215eee4ef7/54dd14ec4_generated_image.png",
  description:
    "كتاب علمي ومنهجي باللغة الأردية والعربية يعالج مشكلة الوساوس القهرية في العقيدة والطهارة والصلاة على ضوء القرآن الكريم والسنة النبوية وقواعد الفقهاء، مزود بطبقة القارئ الذكي الصوتي باللغة الأردية والعربية مع التلاوة القرآنية المسجلة.",
  structured_pages: WASWASA_STRUCTURED_PAGES,
  table_of_contents: WASWASA_STRUCTURED_PAGES.map((p) => ({
    title: p.title,
    page: p.pageNumber,
  })),
  created_date: "2026-01-15T10:00:00.000Z",
  updated_date: "2026-03-01T10:00:00.000Z",
};

/**
 * Generates a real, multi-page PDF 1.4 binary ArrayBuffer containing rendered high-resolution
 * JPEG canvases of the 5 Urdu/Arabic pages so PDF.js renders them with crisp typography,
 * margins, ornaments, and exact bounding-box alignment.
 */
let _cachedWaswasaPdfBuffer = null;

export async function generateWaswasaPdfArrayBuffer() {
  if (_cachedWaswasaPdfBuffer) return _cachedWaswasaPdfBuffer.slice(0);
  if (typeof document === "undefined") {
    return new ArrayBuffer(0);
  }

  const pageWidthPt = 595; // Standard A4 width in points
  const pageHeightPt = 842; // Standard A4 height in points
  const scale = 2; // High-DPI canvas for sharp rendering
  const canvasW = pageWidthPt * scale;
  const canvasH = pageHeightPt * scale;

  const jpegPages = [];

  for (const page of WASWASA_STRUCTURED_PAGES) {
    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");

    // 1. Cream scholarly parchment background
    ctx.fillStyle = "#FCFBF7";
    ctx.fillRect(0, 0, canvasW, canvasH);

    // 2. Classic Islamic scholarly double frame (#155E75 and #0891B2)
    ctx.strokeStyle = "#155E75";
    ctx.lineWidth = 5;
    ctx.strokeRect(42, 42, canvasW - 84, canvasH - 84);

    ctx.strokeStyle = "#0891B2";
    ctx.lineWidth = 1.8;
    ctx.strokeRect(54, 54, canvasW - 108, canvasH - 108);

    // 3. Top header bar
    ctx.fillStyle = "#155E75";
    ctx.font = "bold 22px system-ui, -apple-system, 'Noto Nastaliq Urdu', 'Amiri', serif";
    ctx.textAlign = "right";
    ctx.direction = "rtl";
    ctx.fillText("DAR AL TAWHID • كيف تنقذ نفسك من ورطة الوسوسة؟", canvasW - 80, 92);

    ctx.fillStyle = "#0891B2";
    ctx.textAlign = "left";
    ctx.fillText(`صفحہ ${page.pageNumber} / ${WASWASA_STRUCTURED_PAGES.length}`, 80, 92);

    ctx.strokeStyle = "#CBD5E1";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(75, 110);
    ctx.lineTo(canvasW - 75, 110);
    ctx.stroke();

    // 4. Render each structured block at its exact normalized box2d coordinates
    for (const block of page.blocks) {
      const [ymin, xmin, ymax, xmax] = block.box2d || [150, 80, 260, 920];
      const boxTop = (ymin / 1000) * canvasH;
      const boxLeft = (xmin / 1000) * canvasW;
      const boxBottom = (ymax / 1000) * canvasH;
      const boxRight = (xmax / 1000) * canvasW;
      const boxW = boxRight - boxLeft;
      const boxH = boxBottom - boxTop;

      // Subtle card background for special blocks
      if (block.blockType === "heading") {
        ctx.fillStyle = "#ECFEFF";
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);
        ctx.strokeStyle = "#0891B2";
        ctx.lineWidth = 3;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      } else if (block.blockType === "quran") {
        ctx.fillStyle = "#F0FDFA";
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);
        ctx.strokeStyle = "#155E75";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      } else if (block.blockType === "hadith" || block.blockType === "dua") {
        ctx.fillStyle = "#FEFCE8";
        ctx.fillRect(boxLeft, boxTop, boxW, boxH);
        ctx.strokeStyle = "#D97706";
        ctx.lineWidth = 2;
        ctx.strokeRect(boxLeft, boxTop, boxW, boxH);
      } else if (block.blockType === "footnote") {
        ctx.strokeStyle = "#CBD5E1";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(boxLeft + 120, boxTop - 10);
        ctx.lineTo(boxRight, boxTop - 10);
        ctx.stroke();
      }

      // Typography setup
      ctx.direction = "rtl";
      ctx.textAlign = "right";
      let fontSize = 31;
      let lineHeight = 52;
      if (block.blockType === "heading") {
        ctx.fillStyle = "#155E75";
        fontSize = 34;
        lineHeight = 54;
        ctx.font = `bold ${fontSize}px 'Noto Nastaliq Urdu', 'Amiri', 'Traditional Arabic', serif`;
      } else if (block.blockType === "quran") {
        ctx.fillStyle = "#0F766E";
        fontSize = 36;
        lineHeight = 58;
        ctx.textAlign = "center";
        ctx.font = `bold ${fontSize}px 'Amiri Quran', 'Amiri', 'Traditional Arabic', serif`;
      } else if (block.blockType === "hadith" || block.blockType === "dua" || block.blockType === "arabic_quote") {
        ctx.fillStyle = "#1E293B";
        fontSize = 30;
        lineHeight = 50;
        ctx.font = `bold ${fontSize}px 'Amiri', 'Traditional Arabic', serif`;
      } else if (block.blockType === "footnote") {
        ctx.fillStyle = "#475569";
        fontSize = 23;
        lineHeight = 38;
        ctx.font = `${fontSize}px 'Noto Nastaliq Urdu', 'Amiri', serif`;
      } else {
        ctx.fillStyle = "#0F172A";
        fontSize = 31;
        lineHeight = 54;
        ctx.font = `${fontSize}px 'Noto Nastaliq Urdu', 'Urdu Typesetting', 'Amiri', serif`;
      }

      // Word wrap RTL lines inside [boxLeft + 24, boxRight - 24]
      const maxTextWidth = boxW - 48;
      const words = String(block.originalText || "").split(/\s+/);
      const lines = [];
      let currentLine = "";

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxTextWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) lines.push(currentLine);

      const startY =
        block.blockType === "heading" || block.blockType === "quran"
          ? boxTop + (boxH - lines.length * lineHeight) / 2 + fontSize
          : boxTop + fontSize + 18;

      for (let i = 0; i < lines.length; i++) {
        const xPos =
          block.blockType === "quran" ? boxLeft + boxW / 2 : boxRight - 24;
        ctx.fillText(lines[i], xPos, startY + i * lineHeight);
      }
    }

    // 5. Bottom page number footer
    ctx.fillStyle = "#64748B";
    ctx.font = "22px system-ui, serif";
    ctx.textAlign = "center";
    ctx.fillText(`— ${page.pageNumber} —`, canvasW / 2, canvasH - 68);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    const b64 = dataUrl.split(",")[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    jpegPages.push({ bytes, width: canvasW, height: canvasH });
  }

  _cachedWaswasaPdfBuffer = buildMultiPageJpegPdf(
    jpegPages,
    pageWidthPt,
    pageHeightPt
  );
  return _cachedWaswasaPdfBuffer.slice(0);
}

/**
 * Minimal standards-compliant PDF 1.4 writer embedding JPEG streams per page
 */
function buildMultiPageJpegPdf(jpegPages, pageW, pageH) {
  const encoder = new TextEncoder();
  const chunks = [];
  let offset = 0;
  const xrefOffsets = [0]; // Object 0 is free

  const pushStr = (s) => {
    const b = encoder.encode(s);
    chunks.push(b);
    offset += b.byteLength;
  };
  const pushBytes = (b) => {
    chunks.push(b);
    offset += b.byteLength;
  };

  pushStr("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n");

  // Object 1: Catalog
  xrefOffsets[1] = offset;
  pushStr("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  // Object 2: Pages root
  const pageObjIds = jpegPages.map((_, i) => 3 + i * 3);
  xrefOffsets[2] = offset;
  pushStr(
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjIds
      .map((id) => `${id} 0 R`)
      .join(" ")}] /Count ${jpegPages.length} >>\nendobj\n`
  );

  // Each page uses 3 objects: Page (3+i*3), ContentStream (4+i*3), ImageXObject (5+i*3)
  for (let i = 0; i < jpegPages.length; i++) {
    const pg = jpegPages[i];
    const pageId = 3 + i * 3;
    const contentId = 4 + i * 3;
    const imgId = 5 + i * 3;

    // Page object
    xrefOffsets[pageId] = offset;
    pushStr(
      `${pageId} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im${i} ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>\nendobj\n`
    );

    // Content stream drawing the JPEG full-page
    const streamCmd = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im${i} Do Q\n`;
    xrefOffsets[contentId] = offset;
    pushStr(
      `${contentId} 0 obj\n<< /Length ${streamCmd.length} >>\nstream\n${streamCmd}endstream\nendobj\n`
    );

    // Image XObject
    xrefOffsets[imgId] = offset;
    pushStr(
      `${imgId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${pg.width} /Height ${pg.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.bytes.byteLength} >>\nstream\n`
    );
    pushBytes(pg.bytes);
    pushStr("\nendstream\nendobj\n");
  }

  const xrefStart = offset;
  const totalObjs = xrefOffsets.length;
  pushStr(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let id = 1; id < totalObjs; id++) {
    const offStr = String(xrefOffsets[id]).padStart(10, "0");
    pushStr(`${offStr} 00000 n \n`);
  }
  pushStr(
    `trailer\n<< /Size ${totalObjs} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  );

  const output = new Uint8Array(offset);
  let pos = 0;
  for (const c of chunks) {
    output.set(c, pos);
    pos += c.byteLength;
  }
  return output.buffer;
}
