package com.cove.chat.ui.components

/** Persian and Arabic text for the Bot API screens (English source text maps to the translation). */
internal val BotsFa: Map<String, String> = mapOf(
    "BOT" to "ربات", "Bots" to "ربات‌ها",
    "Bots are programs that read and write chat messages for you. Create one, copy its token and run it anywhere." to "ربات‌ها برنامه‌هایی هستند که به‌جای شما پیام می‌خوانند و می‌نویسند. یکی بسازید، توکن آن را کپی کنید و در هر جایی اجرا کنید.",
    "Bots are switched off on this server." to "ربات‌ها در این سرور خاموش شده‌اند.",
    "Create bot" to "ساخت ربات", "Create a bot" to "ساخت ربات", "Create" to "ساخت",
    "Only server admins can create bots on this server." to "فقط مدیران سرور می‌توانند در این سرور ربات بسازند.",
    "Show every bot on the server" to "نمایش همهٔ ربات‌های سرور", "You have no bots yet." to "هنوز رباتی ندارید.",
    "Disabled" to "غیرفعال", "Online" to "آنلاین", "Offline" to "آفلاین", "Public" to "عمومی", "Private" to "خصوصی", "In 1 channel" to "در ۱ کانال",
    "Bot name *" to "نام ربات *", "2-32 lowercase letters, digits, _ . or -" to "۲ تا ۳۲ حرف کوچک انگلیسی، رقم، _ . یا -",
    "Description" to "توضیحات", "Public bots can be found and added to channels by any channel admin." to "ربات عمومی را هر مدیر کانالی می‌تواند پیدا کند و به کانال خود بیفزاید.",
    "Webhook URL" to "نشانی وب‌هوک", "Optional. Events are POSTed here (https only) when the bot is not connected to the gateway." to "اختیاری. وقتی ربات به گیت‌وی وصل نیست، رویدادها به این نشانی (فقط https) فرستاده می‌شود.",
    "Save your bot token" to "توکن ربات را ذخیره کنید",
    "This is the only time it is shown. Anyone with the token can act as the bot, so keep it private. If it leaks, rotate it." to "این فقط یک‌بار نمایش داده می‌شود. هر کس این توکن را داشته باشد می‌تواند به‌جای ربات عمل کند؛ آن را محرمانه نگه دارید و در صورت افشا آن را بچرخانید.",
    "Bot token" to "توکن ربات", "Webhook signing secret" to "رمز امضای وب‌هوک", "Copy" to "کپی", "I have saved it" to "ذخیره کردم",
    "Enabled" to "فعال", "Public (listed for channel admins)" to "عمومی (برای مدیران کانال نمایش داده شود)",
    "No webhook. The bot must connect to the gateway." to "وب‌هوکی تنظیم نشده است. ربات باید به گیت‌وی وصل شود.",
    "New signing secret" to "رمز امضای جدید", "Rotate token" to "چرخاندن توکن",
    "Issues a new token and disconnects the bot immediately." to "توکن جدید می‌سازد و ربات را بلافاصله قطع می‌کند.",
    "Delete bot" to "حذف ربات", "Bot updated" to "ربات به‌روزرسانی شد", "Bot deleted" to "ربات حذف شد",
    "Couldn't create the bot." to "ساخت ربات ممکن نشد.", "Couldn't load bots." to "بارگیری ربات‌ها ممکن نشد.",
    "Couldn't update the bot." to "به‌روزرسانی ربات ممکن نشد.", "Couldn't delete the bot." to "حذف ربات ممکن نشد.",
    "Couldn't change the bot's installation." to "تغییر نصب ربات ممکن نشد.",
    "Send messages" to "ارسال پیام", "Post, edit and delete its own messages; show buttons and the action menu." to "فرستادن، ویرایش و حذف پیام‌های خودش؛ نمایش دکمه‌ها و منوی اقدام.",
    "Read all messages" to "خواندن همهٔ پیام‌ها", "See every message in the channel. Without it the bot only sees messages that mention or reply to it, and commands." to "دیدن همهٔ پیام‌های کانال. بدون آن ربات فقط پیام‌هایی را می‌بیند که به آن اشاره یا پاسخ داده شده، و دستورها را.",
    "See members" to "دیدن اعضا", "List who is in the channel and get told when someone joins or leaves." to "فهرست اعضای کانال و اطلاع از پیوستن یا ترک اعضا.",
    "No bots in this channel." to "رباتی در این کانال نیست.", "Add a bot" to "افزودن ربات", "Add a bot to this channel" to "افزودن ربات به این کانال",
    "Search public bots" to "جست‌وجوی ربات‌های عمومی", "No bots found." to "رباتی پیدا نشد.", "Permissions" to "مجوزها",
    "The bot's owner (and the server their bot runs on) will receive, as plain text, everything these permissions allow. Only add bots you trust. Bots are never admins." to "مالک ربات (و سروری که ربات روی آن اجرا می‌شود) هر آنچه این مجوزها اجازه می‌دهند را به‌صورت متن ساده دریافت می‌کند. فقط به ربات‌های مورد اعتماد اجازه دهید. ربات‌ها هرگز مدیر نمی‌شوند.",
    "Add bot" to "افزودن ربات", "Bot added" to "ربات افزوده شد", "Bot removed" to "ربات حذف شد", "Choose another bot" to "انتخاب ربات دیگر",
    "Commands" to "دستورها", "Choose an option" to "یک گزینه را انتخاب کنید", "Type a message" to "نوشتن پیام", "Show bot menu" to "نمایش منوی ربات",
    "Couldn't open the link." to "باز کردن پیوند ممکن نشد.", "Opens a link" to "پیوند را باز می‌کند", "This message can't be shown." to "این پیام قابل نمایش نیست.",
    "Public bots" to "ربات‌های عمومی", "No public bots found." to "رباتی عمومی پیدا نشد.", "No description" to "بدون توضیح", "1 command" to "۱ دستور", "Message" to "پیام",
    "Bot chat options" to "گزینه‌های گفتگو با ربات", "Clear history" to "پاک کردن تاریخچه", "Remove conversation" to "حذف گفتگو", "Block bot" to "مسدود کردن ربات",
    "History cleared" to "تاریخچه پاک شد", "Conversation removed" to "گفتگو حذف شد", "Couldn't clear the history." to "پاک کردن تاریخچه ممکن نشد.",
    "Couldn't remove the conversation." to "حذف گفتگو ممکن نشد.", "Couldn't block the bot." to "مسدود کردن ربات ممکن نشد.",
    "Sent a bot message" to "پیام ربات فرستاد", "Couldn't send that to the bot." to "ارسال به ربات ممکن نشد.", "Manage" to "مدیریت"
)

internal val BotsAr: Map<String, String> = mapOf(
    "BOT" to "روبوت", "Bots" to "الروبوتات",
    "Bots are programs that read and write chat messages for you. Create one, copy its token and run it anywhere." to "الروبوتات برامج تقرأ الرسائل وتكتبها نيابةً عنك. أنشئ روبوتًا وانسخ رمزه وشغّله في أي مكان.",
    "Bots are switched off on this server." to "الروبوتات معطّلة على هذا الخادم.",
    "Create bot" to "إنشاء روبوت", "Create a bot" to "إنشاء روبوت", "Create" to "إنشاء",
    "Only server admins can create bots on this server." to "يمكن لمشرفي الخادم فقط إنشاء روبوتات على هذا الخادم.",
    "Show every bot on the server" to "عرض كل روبوتات الخادم", "You have no bots yet." to "ليس لديك روبوتات بعد.",
    "Disabled" to "معطّل", "Online" to "متصل", "Offline" to "غير متصل", "Public" to "عام", "Private" to "خاص", "In 1 channel" to "في قناة واحدة",
    "Bot name *" to "اسم الروبوت *", "2-32 lowercase letters, digits, _ . or -" to "من 2 إلى 32 حرفًا صغيرًا أو رقمًا أو _ . أو -",
    "Description" to "الوصف", "Public bots can be found and added to channels by any channel admin." to "يمكن لأي مشرف قناة العثور على الروبوت العام وإضافته إلى قناته.",
    "Webhook URL" to "عنوان Webhook", "Optional. Events are POSTed here (https only) when the bot is not connected to the gateway." to "اختياري. تُرسل الأحداث إلى هنا (https فقط) عندما لا يكون الروبوت متصلًا بالبوابة.",
    "Save your bot token" to "احفظ رمز الروبوت",
    "This is the only time it is shown. Anyone with the token can act as the bot, so keep it private. If it leaks, rotate it." to "يظهر هذا مرة واحدة فقط. يستطيع أي شخص يملك الرمز التصرف باسم الروبوت، لذا أبقِه سريًا. إذا تسرّب فقم بتدويره.",
    "Bot token" to "رمز الروبوت", "Webhook signing secret" to "سر توقيع Webhook", "Copy" to "نسخ", "I have saved it" to "لقد حفظته",
    "Enabled" to "مفعّل", "Public (listed for channel admins)" to "عام (يظهر لمشرفي القنوات)",
    "No webhook. The bot must connect to the gateway." to "لا يوجد Webhook. يجب أن يتصل الروبوت بالبوابة.",
    "New signing secret" to "سر توقيع جديد", "Rotate token" to "تدوير الرمز",
    "Issues a new token and disconnects the bot immediately." to "يُصدر رمزًا جديدًا ويقطع اتصال الروبوت فورًا.",
    "Delete bot" to "حذف الروبوت", "Bot updated" to "تم تحديث الروبوت", "Bot deleted" to "تم حذف الروبوت",
    "Couldn't create the bot." to "تعذّر إنشاء الروبوت.", "Couldn't load bots." to "تعذّر تحميل الروبوتات.",
    "Couldn't update the bot." to "تعذّر تحديث الروبوت.", "Couldn't delete the bot." to "تعذّر حذف الروبوت.",
    "Couldn't change the bot's installation." to "تعذّر تغيير تثبيت الروبوت.",
    "Send messages" to "إرسال الرسائل", "Post, edit and delete its own messages; show buttons and the action menu." to "نشر رسائله وتعديلها وحذفها؛ وعرض الأزرار وقائمة الإجراءات.",
    "Read all messages" to "قراءة كل الرسائل", "See every message in the channel. Without it the bot only sees messages that mention or reply to it, and commands." to "رؤية كل رسائل القناة. بدونه لا يرى الروبوت إلا الرسائل التي تذكره أو تردّ عليه والأوامر.",
    "See members" to "رؤية الأعضاء", "List who is in the channel and get told when someone joins or leaves." to "عرض من في القناة والتنبيه عند انضمام أحد أو مغادرته.",
    "No bots in this channel." to "لا توجد روبوتات في هذه القناة.", "Add a bot" to "إضافة روبوت", "Add a bot to this channel" to "إضافة روبوت إلى هذه القناة",
    "Search public bots" to "ابحث عن الروبوتات العامة", "No bots found." to "لم يتم العثور على روبوتات.", "Permissions" to "الأذونات",
    "The bot's owner (and the server their bot runs on) will receive, as plain text, everything these permissions allow. Only add bots you trust. Bots are never admins." to "سيتلقى مالك الروبوت (والخادم الذي يعمل عليه) كل ما تسمح به هذه الأذونات كنص عادي. أضف الروبوتات الموثوقة فقط. لا يكون الروبوت مشرفًا أبدًا.",
    "Add bot" to "إضافة الروبوت", "Bot added" to "تمت إضافة الروبوت", "Bot removed" to "تمت إزالة الروبوت", "Choose another bot" to "اختر روبوتًا آخر",
    "Commands" to "الأوامر", "Choose an option" to "اختر خيارًا", "Type a message" to "كتابة رسالة", "Show bot menu" to "عرض قائمة الروبوت",
    "Couldn't open the link." to "تعذّر فتح الرابط.", "Opens a link" to "يفتح رابطًا", "This message can't be shown." to "لا يمكن عرض هذه الرسالة.",
    "Public bots" to "الروبوتات العامة", "No public bots found." to "لم يتم العثور على روبوتات عامة.", "No description" to "بلا وصف", "1 command" to "أمر واحد", "Message" to "مراسلة",
    "Bot chat options" to "خيارات محادثة الروبوت", "Clear history" to "مسح السجل", "Remove conversation" to "إزالة المحادثة", "Block bot" to "حظر الروبوت",
    "History cleared" to "تم مسح السجل", "Conversation removed" to "تمت إزالة المحادثة", "Couldn't clear the history." to "تعذّر مسح السجل.",
    "Couldn't remove the conversation." to "تعذّرت إزالة المحادثة.", "Couldn't block the bot." to "تعذّر حظر الروبوت.",
    "Sent a bot message" to "أرسل رسالة روبوت", "Couldn't send that to the bot." to "تعذّر إرسال ذلك إلى الروبوت.", "Manage" to "إدارة"
)

/** Strings that carry a name or a number. */
internal val BotsPatterns: List<Pattern> = listOf(
    Pattern(Regex("Clear your messages with (.+)\\? This only affects your side; (.+) keeps its own copy\\. The chat stays in your list\\.", RegexOption.DOT_MATCHES_ALL)) { m, l ->
        if (l == "fa") "پیام‌های شما با ${m.groupValues[1]} پاک شود؟ این فقط روی سمت شما اثر دارد و ${m.groupValues[2]} نسخهٔ خودش را نگه می‌دارد. گفتگو در فهرست شما می‌ماند."
        else "هل تريد مسح رسائلك مع ${m.groupValues[1]}؟ يؤثر هذا على جانبك فقط ويحتفظ ${m.groupValues[2]} بنسخته. تبقى المحادثة في قائمتك."
    },
    Pattern(Regex("Remove the chat with (.+) from your list\\? You can start it again from Explore > Bots; the old messages stay hidden\\.", RegexOption.DOT_MATCHES_ALL)) { m, l ->
        if (l == "fa") "گفتگو با ${m.groupValues[1]} از فهرست شما حذف شود؟ می‌توانید دوباره از کاوش > ربات‌ها آن را شروع کنید؛ پیام‌های قبلی پنهان می‌مانند."
        else "هل تريد إزالة المحادثة مع ${m.groupValues[1]} من قائمتك؟ يمكنك بدءها مجددًا من استكشاف > الروبوتات؛ تبقى الرسائل القديمة مخفية."
    },
    Pattern(Regex("Block (.+)\\? It can no longer message you or be started until you unblock it\\.", RegexOption.DOT_MATCHES_ALL)) { m, l ->
        if (l == "fa") "${m.groupValues[1]} مسدود شود؟ تا زمانی که رفع انسداد نکنید نمی‌تواند به شما پیام بدهد یا شروع شود."
        else "هل تريد حظر ${m.groupValues[1]}؟ لن يتمكن من مراسلتك ولا يمكن بدؤه حتى تلغي الحظر."
    },
    Pattern(Regex("(.+) blocked")) { m, l -> if (l == "fa") "${m.groupValues[1]} مسدود شد" else "تم حظر ${m.groupValues[1]}" },
    Pattern(Regex("(\\d+) commands")) { m, l -> if (l == "fa") "${m.groupValues[1]} دستور" else "${m.groupValues[1]} أوامر" },
    Pattern(Regex("(.+) is offline right now\\. It will answer when it is back\\.", RegexOption.DOT_MATCHES_ALL)) { m, l ->
        if (l == "fa") "${m.groupValues[1]} اکنون آفلاین است و پس از بازگشت پاسخ می‌دهد." else "${m.groupValues[1]} غير متصل حاليًا وسيرد عند عودته."
    },
    Pattern(Regex("Manage (.+)", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "مدیریت ${m.groupValues[1]}" else "إدارة ${m.groupValues[1]}" },
    Pattern(Regex("Remove (.+) from this channel\\?", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "${m.groupValues[1]} از این کانال حذف شود؟" else "هل تريد إزالة ${m.groupValues[1]} من هذه القناة؟" },
    Pattern(Regex("Remove (.+)", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "حذف ${m.groupValues[1]}" else "إزالة ${m.groupValues[1]}" },
    Pattern(Regex("Delete (.+)\\? It is removed from every channel and its token stops working\\. Its past messages stay\\.", RegexOption.DOT_MATCHES_ALL)) { m, l ->
        if (l == "fa") "${m.groupValues[1]} حذف شود؟ از همهٔ کانال‌ها برداشته می‌شود و توکن آن از کار می‌افتد. پیام‌های گذشتهٔ آن می‌مانند."
        else "هل تريد حذف ${m.groupValues[1]}؟ تتم إزالته من كل القنوات ويتوقف رمزه عن العمل. تبقى رسائله السابقة."
    },
    Pattern(Regex("(.+) is offline and cannot answer right now\\.", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "${m.groupValues[1]} آفلاین است و اکنون نمی‌تواند پاسخ دهد." else "${m.groupValues[1]} غير متصل ولا يمكنه الرد الآن." },
    Pattern(Regex("In (\\d+) channels")) { m, l -> if (l == "fa") "در ${m.groupValues[1]} کانال" else "في ${m.groupValues[1]} قنوات" },
    Pattern(Regex("You have reached the limit of (\\d+) bots\\.")) { m, l -> if (l == "fa") "به سقف ${m.groupValues[1]} ربات رسیده‌اید." else "لقد بلغت الحد الأقصى وهو ${m.groupValues[1]} روبوتات." },
    Pattern(Regex("Missing value for \"(.+)\"\\.", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "مقدار «${m.groupValues[1]}» وارد نشده است." else "قيمة «${m.groupValues[1]}» مفقودة." },
    Pattern(Regex("\"(.+)\" has an invalid value\\.", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "مقدار «${m.groupValues[1]}» معتبر نیست." else "قيمة «${m.groupValues[1]}» غير صالحة." },
    Pattern(Regex("Unexpected value \"(.+)\"\\.", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "مقدار «${m.groupValues[1]}» غیرمنتظره است." else "قيمة غير متوقعة «${m.groupValues[1]}»." },
    Pattern(Regex("\"(.+)\" must be one of its listed choices\\.", RegexOption.DOT_MATCHES_ALL)) { m, l -> if (l == "fa") "«${m.groupValues[1]}» باید یکی از گزینه‌های فهرست‌شده باشد." else "يجب أن تكون «${m.groupValues[1]}» أحد الخيارات المدرجة." }
)
