package com.cove.chat.ui.components

/** Persian strings added after the main table in [Translations] (chat input, backgrounds, calls, Whisper); merged into it. */
internal val ExtraFa: Map<String, String> = mapOf(
    "Forward to…" to "ارسال به…", "Forward" to "هدایت", "Copy" to "کپی", "Copied" to "کپی شد", "Forwarded" to "هدایت شد",
    "Couldn't forward the message." to "هدایت پیام ممکن نشد.", "Only text messages can be forwarded." to "فقط پیام‌های متنی قابل هدایت‌اند.",
    "Group profile" to "پروفایل گروه", "ABOUT" to "درباره", "Allow microphone access in Settings to record voice messages." to "برای ضبط پیام صوتی، در تنظیمات دسترسی میکروفون را مجاز کنید.",
    // Chat input and backgrounds
    "Photo or Video" to "عکس یا ویدیو", "Audio" to "صدا", "Document / File" to "سند / فایل", "Video message" to "پیام ویدیویی",
    "Slide left to cancel" to "برای لغو به چپ بکشید", "Slide right to cancel" to "برای لغو به راست بکشید", "Recording" to "در حال ضبط",
    "CHAT BACKGROUND" to "پس‌زمینه گفتگو", "None" to "هیچ", "Animals" to "حیوانات", "Space" to "فضا", "Games" to "بازی‌ها", "Sweets" to "شیرینی‌ها",
    // Calls
    "Poor network, video quality reduced" to "شبکه ضعیف است، کیفیت ویدیو کاهش یافت", "Couldn't start screen sharing." to "اشتراک صفحه شروع نشد.",
    "Screen share paused" to "اشتراک صفحه متوقف شد", "Audio output" to "خروجی صدا", "Earpiece" to "گوشی", "Speaker" to "بلندگو",
    "Bluetooth" to "بلوتوث", "Headset" to "هدست", "Deafen" to "ناشنوا کردن", "Silence everyone else's audio" to "صدای بقیه را قطع کن",
    "Switch camera" to "تعویض دوربین", "Camera quality" to "کیفیت دوربین", "Low" to "کم", "Medium" to "متوسط", "High" to "زیاد",
    "Screen share quality" to "کیفیت اشتراک صفحه", "Data saver" to "صرفه‌جویی داده", "Balanced" to "متعادل", "Sharp" to "شفاف",
    "Adaptive quality" to "کیفیت تطبیقی", "Lower the video quality automatically on a poor network" to "در شبکه ضعیف کیفیت ویدیو خودکار کاهش یابد",
    "Shared screens (receiving)" to "صفحه‌های اشتراکی (دریافت)", "Full" to "کامل", "Reduced (15 fps)" to "کاهش‌یافته (۱۵ فریم)",
    "Low (5 fps)" to "کم (۵ فریم)", "Paused" to "متوقف", "Mute" to "بی‌صدا", "Unmute" to "فعال‌سازی صدا", "Turn camera off" to "خاموش کردن دوربین",
    "Turn camera on" to "روشن کردن دوربین", "Share screen" to "اشتراک صفحه", "Stop sharing" to "توقف اشتراک", "More call options" to "گزینه‌های بیشتر تماس",
    "Full screen" to "تمام‌صفحه", "Reconnecting…" to "در حال اتصال مجدد…", "In call" to "در تماس", "Sharing your screen" to "صفحه شما در حال اشتراک است",
    "Couldn't connect to the call." to "اتصال به تماس برقرار نشد.", "Cove Active Call" to "تماس فعال Cove",
    "Shows persistent status while in a Cove audio or video call" to "وضعیت تماس صوتی یا تصویری Cove را نشان می‌دهد",
    // Whisper
    "View saved Whisper messages" to "مشاهده پیام‌های ذخیره‌شدهٔ نجوا", "wants to start an end-to-end encrypted Whisper." to "می‌خواهد یک نجوای رمزنگاری‌شده شروع کند.",
    "New Whisper message" to "پیام جدید نجوا", "Mark as verified" to "علامت‌گذاری به‌عنوان تأییدشده", "Mark as not verified" to "حذف علامت تأیید",
    "Verified" to "تأییدشده", "End session" to "پایان نشست", "Burn chat" to "سوزاندن گفتگو", "End this Whisper?" to "این نجوا پایان یابد؟",
    "The session ends for both of you. Saved messages stay on this device until you delete them." to "نشست برای هر دوی شما پایان می‌یابد. پیام‌های ذخیره‌شده تا زمان حذف روی این دستگاه می‌مانند.",
    "The session ends for both of you and every message is discarded." to "نشست برای هر دوی شما پایان می‌یابد و همهٔ پیام‌ها حذف می‌شوند.",
    "Burn this chat?" to "این گفتگو سوزانده شود؟", "Every message, key and saved copy is destroyed on both devices. This can't be undone." to "همهٔ پیام‌ها، کلیدها و نسخه‌های ذخیره‌شده روی هر دو دستگاه نابود می‌شوند. این کار قابل بازگشت نیست.",
    "Burn" to "بسوزان", "Delete from this device" to "حذف از این دستگاه", "Couldn't read that file, or it is larger than 10 MB." to "فایل خوانده نشد یا بزرگ‌تر از ۱۰ مگابایت است.",
    "No app can open this file." to "برنامه‌ای برای باز کردن این فایل نیست.", "Play voice message" to "پخش پیام صوتی", "Pause" to "توقف", "Play video" to "پخش ویدیو",
    "Messages are encrypted on both devices and kept only on them. Compare the safety number to verify who you're talking to." to "پیام‌ها روی هر دو دستگاه رمزنگاری و فقط روی همان‌ها نگهداری می‌شوند. برای اطمینان از هویت مخاطب، شمارهٔ امنیتی را مقایسه کنید.",
    "Session closed. Saved messages stay on this device." to "نشست بسته شد. پیام‌های ذخیره‌شده روی این دستگاه می‌مانند.",
    "This Whisper ended. Saved messages stay on this device." to "این نجوا پایان یافت. پیام‌های ذخیره‌شده روی این دستگاه می‌مانند.",
    "The other person ended the session. Saved messages stay on this device." to "طرف مقابل نشست را بست. پیام‌های ذخیره‌شده روی این دستگاه می‌مانند.",
    "Peer disconnected. Saved messages stay on this device." to "طرف مقابل قطع شد. پیام‌های ذخیره‌شده روی این دستگاه می‌مانند.",
    "Peer disconnected." to "طرف مقابل قطع شد.", "The other person ended the session." to "طرف مقابل نشست را بست.",
    "This chat was burned and all data destroyed." to "این گفتگو سوزانده شد و همهٔ داده‌ها نابود شد.", "Your request was declined." to "درخواست شما رد شد.",
    "Couldn't establish the encrypted session." to "برقراری نشست رمزنگاری‌شده ممکن نشد.", "Session closed due to an error." to "نشست به‌دلیل خطا بسته شد."
)

/** Arabic strings added after the main table in [Translations] (chat input, backgrounds, calls, Whisper); merged into it. */
internal val ExtraAr: Map<String, String> = mapOf(
    "Forward to…" to "إعادة توجيه إلى…", "Forward" to "إعادة توجيه", "Copy" to "نسخ", "Copied" to "تم النسخ", "Forwarded" to "تمت إعادة التوجيه",
    "Couldn't forward the message." to "تعذرت إعادة توجيه الرسالة.", "Only text messages can be forwarded." to "يمكن إعادة توجيه الرسائل النصية فقط.",
    "Group profile" to "ملف المجموعة", "ABOUT" to "حول", "Allow microphone access in Settings to record voice messages." to "اسمح بالوصول إلى الميكروفون من الإعدادات لتسجيل الرسائل الصوتية.",
    // Chat input and backgrounds
    "Photo or Video" to "صورة أو فيديو", "Audio" to "صوت", "Document / File" to "مستند / ملف", "Video message" to "رسالة فيديو",
    "Slide left to cancel" to "اسحب لليسار للإلغاء", "Slide right to cancel" to "اسحب لليمين للإلغاء", "Recording" to "جارٍ التسجيل",
    "CHAT BACKGROUND" to "خلفية المحادثة", "None" to "بلا", "Animals" to "حيوانات", "Space" to "الفضاء", "Games" to "ألعاب", "Sweets" to "حلويات",
    // Calls
    "Poor network, video quality reduced" to "الشبكة ضعيفة، تم تقليل جودة الفيديو", "Couldn't start screen sharing." to "تعذر بدء مشاركة الشاشة.",
    "Screen share paused" to "تم إيقاف مشاركة الشاشة", "Audio output" to "مخرج الصوت", "Earpiece" to "سماعة الأذن", "Speaker" to "مكبر الصوت",
    "Bluetooth" to "بلوتوث", "Headset" to "سماعة الرأس", "Deafen" to "كتم الاستماع", "Silence everyone else's audio" to "كتم صوت الآخرين",
    "Switch camera" to "تبديل الكاميرا", "Camera quality" to "جودة الكاميرا", "Low" to "منخفضة", "Medium" to "متوسطة", "High" to "عالية",
    "Screen share quality" to "جودة مشاركة الشاشة", "Data saver" to "توفير البيانات", "Balanced" to "متوازنة", "Sharp" to "حادة",
    "Adaptive quality" to "جودة تكيفية", "Lower the video quality automatically on a poor network" to "خفض جودة الفيديو تلقائيًا عند ضعف الشبكة",
    "Shared screens (receiving)" to "الشاشات المشتركة (الاستقبال)", "Full" to "كاملة", "Reduced (15 fps)" to "مخفضة (15 إطارًا)",
    "Low (5 fps)" to "منخفضة (5 إطارات)", "Paused" to "متوقفة", "Mute" to "كتم", "Unmute" to "إلغاء الكتم", "Turn camera off" to "إيقاف الكاميرا",
    "Turn camera on" to "تشغيل الكاميرا", "Share screen" to "مشاركة الشاشة", "Stop sharing" to "إيقاف المشاركة", "More call options" to "خيارات المكالمة الإضافية",
    "Full screen" to "ملء الشاشة", "Reconnecting…" to "جارٍ إعادة الاتصال…", "In call" to "في المكالمة", "Sharing your screen" to "تتم مشاركة شاشتك",
    "Couldn't connect to the call." to "تعذر الاتصال بالمكالمة.", "Cove Active Call" to "مكالمة Cove النشطة",
    "Shows persistent status while in a Cove audio or video call" to "يعرض حالة مكالمة Cove الصوتية أو المرئية",
    // Whisper
    "View saved Whisper messages" to "عرض رسائل الهمسة المحفوظة", "wants to start an end-to-end encrypted Whisper." to "يريد بدء همسة مشفرة من طرف إلى طرف.",
    "New Whisper message" to "رسالة همسة جديدة", "Mark as verified" to "وضع علامة تم التحقق", "Mark as not verified" to "إزالة علامة التحقق",
    "Verified" to "تم التحقق", "End session" to "إنهاء الجلسة", "Burn chat" to "حرق المحادثة", "End this Whisper?" to "إنهاء هذه الهمسة؟",
    "The session ends for both of you. Saved messages stay on this device until you delete them." to "تنتهي الجلسة لكليكما. تبقى الرسائل المحفوظة على هذا الجهاز حتى تحذفها.",
    "The session ends for both of you and every message is discarded." to "تنتهي الجلسة لكليكما وتُحذف كل الرسائل.",
    "Burn this chat?" to "حرق هذه المحادثة؟", "Every message, key and saved copy is destroyed on both devices. This can't be undone." to "تُدمَّر كل الرسائل والمفاتيح والنسخ المحفوظة على الجهازين. لا يمكن التراجع عن ذلك.",
    "Burn" to "حرق", "Delete from this device" to "حذف من هذا الجهاز", "Couldn't read that file, or it is larger than 10 MB." to "تعذرت قراءة الملف أو أنه أكبر من 10 ميغابايت.",
    "No app can open this file." to "لا يوجد تطبيق يفتح هذا الملف.", "Play voice message" to "تشغيل الرسالة الصوتية", "Pause" to "إيقاف مؤقت", "Play video" to "تشغيل الفيديو",
    "Messages are encrypted on both devices and kept only on them. Compare the safety number to verify who you're talking to." to "الرسائل مشفرة على الجهازين وتُحفظ عليهما فقط. قارن رقم الأمان للتحقق من هوية محدثك.",
    "Session closed. Saved messages stay on this device." to "أُغلقت الجلسة. تبقى الرسائل المحفوظة على هذا الجهاز.",
    "This Whisper ended. Saved messages stay on this device." to "انتهت هذه الهمسة. تبقى الرسائل المحفوظة على هذا الجهاز.",
    "The other person ended the session. Saved messages stay on this device." to "أنهى الطرف الآخر الجلسة. تبقى الرسائل المحفوظة على هذا الجهاز.",
    "Peer disconnected. Saved messages stay on this device." to "انقطع اتصال الطرف الآخر. تبقى الرسائل المحفوظة على هذا الجهاز.",
    "Peer disconnected." to "انقطع اتصال الطرف الآخر.", "The other person ended the session." to "أنهى الطرف الآخر الجلسة.",
    "This chat was burned and all data destroyed." to "تم حرق هذه المحادثة وتدمير كل البيانات.", "Your request was declined." to "تم رفض طلبك.",
    "Couldn't establish the encrypted session." to "تعذر إنشاء الجلسة المشفرة.", "Session closed due to an error." to "أُغلقت الجلسة بسبب خطأ."
)
