// ─── Localised labels for stored data values (categories & book languages) ───
// The stored value stays Arabic (the entity enum); only the label shown changes.

const CATEGORY_LABELS = {
  "الكل": { en: "All", fr: "Tout", ur: "سب", hi: "सभी", tr: "Tümü" },
  "all": { en: "All", fr: "Tout", ur: "سب", hi: "सभी", tr: "Tümü" },
  "القرآن وعلومه": { en: "Quran & its Sciences", fr: "Coran et ses sciences", ur: "قرآن و علومِ قرآن", hi: "क़ुरआन और उसके विज्ञान", tr: "Kur'an ve İlimleri" },
  "الحديث الشريف": { en: "Noble Hadith", fr: "Hadith noble", ur: "حدیث شریف", hi: "हदीस शरीफ़", tr: "Hadis-i Şerif" },
  "حديث": { en: "Noble Hadith", fr: "Hadith noble", ur: "حدیث شریف", hi: "हदीस शरीफ़", tr: "Hadis-i Şerif" },
  "الفقه الإسلامي": { en: "Islamic Jurisprudence", fr: "Jurisprudence islamique", ur: "اسلامی فقہ", hi: "इस्लामी फ़िक़्ह", tr: "İslam Fıkhı" },
  "فقه": { en: "Islamic Jurisprudence", fr: "Jurisprudence islamique", ur: "اسلامی فقہ", hi: "इस्लामी फ़िक़्ह", tr: "İslam Fıkhı" },
  "السيرة النبوية": { en: "Prophetic Biography", fr: "Biographie du Prophète", ur: "سیرتِ نبوی", hi: "सीरत-ए-नबवी", tr: "Siyer-i Nebi" },
  "سيرة": { en: "Prophetic Biography", fr: "Biographie du Prophète", ur: "سیرتِ نبوی", hi: "सीरत-ए-नबवी", tr: "Siyer-i Nebi" },
  "العقيدة": { en: "Creed (Aqeedah)", fr: "Croyance (Aqida)", ur: "عقیدہ", hi: "अक़ीदा", tr: "Akide" },
  "عقيدة": { en: "Creed (Aqeedah)", fr: "Croyance (Aqida)", ur: "عقیدہ", hi: "अक़ीदा", tr: "Akide" },
  "التوحيد": { en: "Monotheism (Tawhid)", fr: "Monothéisme (Tawhid)", ur: "توحید", hi: "तौहीद", tr: "Tevhid" },
  "توحيد": { en: "Monotheism (Tawhid)", fr: "Monothéisme (Tawhid)", ur: "توحید", hi: "तौहीद", tr: "Tevhid" },
  "التزكية والرقائق": { en: "Purification of the Soul", fr: "Purification de l'âme", ur: "تزکیہ و رقائق", hi: "आत्म-शुद्धि", tr: "Tezkiye ve Rekaik" },
  "تزكية": { en: "Purification of the Soul", fr: "Purification de l'âme", ur: "تزکیہ و رقائق", hi: "आत्म-शुद्धि", tr: "Tezkiye ve Rekaik" },
  "التاريخ الإسلامي": { en: "Islamic History", fr: "Histoire islamique", ur: "اسلامی تاریخ", hi: "इस्लामी इतिहास", tr: "İslam Tarihi" },
  "تاريخ": { en: "Islamic History", fr: "Histoire islamique", ur: "اسلامی تاریخ", hi: "इस्लामी इतिहास", tr: "İslam Tarihi" },
  "محاضرات ودروس": { en: "Lectures & Lessons", fr: "Conférences et cours", ur: "خطبات و اسباق", hi: "व्याख्यान और पाठ", tr: "Dersler ve Sohbetler" },
  "دروس ومحاضرات": { en: "Lessons & Lectures", fr: "Cours et conférences", ur: "اسباق و خطبات", hi: "पाठ और व्याख्यान", tr: "Dersler ve Sohbetler" },
  "محاضرات": { en: "Lectures", fr: "Conférences", ur: "خطبات", hi: "व्याख्यान", tr: "Sohbetler" },
  "دروس": { en: "Lessons", fr: "Cours", ur: "اسباق", hi: "सबक", tr: "Dersler" },
  "فتاوى": { en: "Fatwas", fr: "Fatwas", ur: "فتاویٰ", hi: "फतवे", tr: "Fetvalar" },
  "خطب": { en: "Sermons", fr: "Sermons", ur: "خطباتِ جمعہ", hi: "उपदेश", tr: "Hutbeler" },
  "التفسير": { en: "Quranic Exegesis (Tafsir)", fr: "Exégèse (Tafsir)", ur: "تفسیر", hi: "तफ़सीर", tr: "Tefsir" },
  "تفسير": { en: "Quranic Exegesis (Tafsir)", fr: "Exégèse (Tafsir)", ur: "تفسیر", hi: "तफ़सीर", tr: "Tefsir" },
  "اللغة العربية": { en: "Arabic Language", fr: "Langue arabe", ur: "عربی زبان", hi: "अरबी भाषा", tr: "Arap Dili" },
  "مقاطع قصيرة": { en: "Shorts", fr: "Shorts", ur: "شارٹس", hi: "शॉर्ट्स", tr: "Kısa Videolar" },
  "بث مباشر": { en: "Live Stream", fr: "En direct", ur: "براہ راست", hi: "लाइव", tr: "Canlı Yayın" },
  "عام": { en: "General", fr: "Général", ur: "عام", hi: "सामान्य", tr: "Genel" },
  "أخرى": { en: "Other", fr: "Autre", ur: "دیگر", hi: "अन्य", tr: "Diğer" },
  "أردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اوردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اورد": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "الأوردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "الأردية": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "العربية": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "عربي": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "الإنجليزية": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "الفرنسية": { en: "French", fr: "Français", ur: "فرانسیسی", hi: "फ़्रांसीसी", tr: "Fransızca" },
  "الهندية": { en: "Hindi", fr: "Hindi", ur: "ہندی", hi: "हिंदी", tr: "Hintçe" },
  "التركية": { en: "Turkish", fr: "Turc", ur: "ترکی", hi: "तुर्की", tr: "Türkçe" },
};

const BOOK_LANG_LABELS = {
  "الكل": { en: "All", fr: "Tout", ur: "سب", hi: "सभी", tr: "Tümü" },
  "all": { en: "All", fr: "Tout", ur: "سب", hi: "सभी", tr: "Tümü" },
  "العربية": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "عربي": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "ar": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "Arabic": { en: "Arabic", fr: "Arabe", ur: "عربی", hi: "अरबी", tr: "Arapça" },
  "الإنجليزية": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "انجليزي": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "إنجليزي": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "en": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "English": { en: "English", fr: "Anglais", ur: "انگریزی", hi: "अंग्रेज़ी", tr: "İngilizce" },
  "الفرنسية": { en: "French", fr: "Français", ur: "فرانسیسی", hi: "फ़्रांसीसी", tr: "Fransızca" },
  "فرنسي": { en: "French", fr: "Français", ur: "فرانسیسی", hi: "फ़्रांसीसी", tr: "Fransızca" },
  "fr": { en: "French", fr: "Français", ur: "فرانسیسی", hi: "फ़्रांसीसी", tr: "Fransızca" },
  "French": { en: "French", fr: "Français", ur: "فرانسیسی", hi: "फ़्रांसीसी", tr: "Fransızca" },
  "الأوردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "الأردية": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "أردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اوردو": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "اورد": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "ur": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "Urdu": { en: "Urdu", fr: "Ourdou", ur: "اردو", hi: "उर्दू", tr: "Urduca" },
  "الهندية": { en: "Hindi", fr: "Hindi", ur: "ہندی", hi: "हिंदी", tr: "Hintçe" },
  "هندي": { en: "Hindi", fr: "Hindi", ur: "ہندی", hi: "हिंदी", tr: "Hintçe" },
  "hi": { en: "Hindi", fr: "Hindi", ur: "ہندی", hi: "हिंदी", tr: "Hintçe" },
  "Hindi": { en: "Hindi", fr: "Hindi", ur: "ہندی", hi: "हिंदी", tr: "Hintçe" },
  "التركية": { en: "Turkish", fr: "Turc", ur: "ترکی", hi: "तुर्की", tr: "Türkçe" },
  "تركي": { en: "Turkish", fr: "Turc", ur: "ترکی", hi: "तुर्की", tr: "Türkçe" },
  "tr": { en: "Turkish", fr: "Turc", ur: "ترکی", hi: "तुर्की", tr: "Türkçe" },
  "Turkish": { en: "Turkish", fr: "Turc", ur: "ترکی", hi: "तुर्की", tr: "Türkçe" },
  "أخرى": { en: "Other", fr: "Autre", ur: "دیگر", hi: "अन्य", tr: "Diğer" },
};

const pick = (map, value, lang) => {
  if (!value) return value;
  const trimmed = String(value).trim();
  const code = typeof lang === "object" ? lang?.langCode : lang;
  if (!code || code === "ar") {
    if (trimmed === "ur" || trimmed === "اورد" || trimmed === "اوردو" || trimmed === "Urdu") return "اردو";
    if (trimmed === "en" || trimmed === "انجليزي" || trimmed === "English") return "الإنجليزية";
    if (trimmed === "fr" || trimmed === "فرنسي" || trimmed === "French") return "الفرنسية";
    if (trimmed === "hi" || trimmed === "هندي" || trimmed === "Hindi") return "الهندية";
    if (trimmed === "tr" || trimmed === "تركي" || trimmed === "Turkish") return "التركية";
    if (trimmed === "ar" || trimmed === "عربي" || trimmed === "Arabic") return "العربية";
    return trimmed;
  }
  return map[trimmed]?.[code] || BOOK_LANG_LABELS[trimmed]?.[code] || CATEGORY_LABELS[trimmed]?.[code] || trimmed;
};

export const catLabel = (value, lang) => pick(CATEGORY_LABELS, value, lang);
export const bookLangLabel = (value, lang) => pick(BOOK_LANG_LABELS, value, lang);
export const BOOK_LANG_VALUES = ["العربية", "الأوردو", "الإنجليزية", "الفرنسية", "الهندية", "التركية"];