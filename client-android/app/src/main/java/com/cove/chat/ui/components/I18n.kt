package com.cove.chat.ui.components

import android.content.Context
import android.widget.Toast
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit

/**
 * App language. The source strings are English; fa/ar are looked up in [Translations]. Following the web client,
 * Arabic renders right-to-left while Farsi stays left-to-right (a product decision, see client-web `RTL_LANGUAGES`).
 */
object AppLanguage {
    /** "en", "fa" or "ar". Reading this inside a composable makes it recompose when the language changes. */
    var code by mutableStateOf("en")

    val isRtl: Boolean get() = code == "ar"

    fun translate(text: String): String {
        if (code == "en" || text.isBlank()) return text
        val table = if (code == "fa") Translations.fa else Translations.ar
        table[text]?.let { return it }
        for (p in Translations.patterns) {
            val m = p.regex.matchEntire(text) ?: continue
            return p.render(m, code)
        }
        return text
    }
}

/** Shorthand for non-composable call sites (toasts, notifications). */
fun t(text: String): String = AppLanguage.translate(text)

/** Drop-in for `Toast.makeText` that translates the message first. */
object I18nToast {
    fun make(context: Context, text: CharSequence, duration: Int): Toast = Toast.makeText(context, t(text.toString()), duration)
}

/**
 * Drop-in replacement for material3 `Text` taking a plain string: the string is translated to the current
 * app language, everything else is forwarded unchanged.
 */
@Composable
fun Text(
    text: String,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontStyle: FontStyle? = null,
    fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip,
    softWrap: Boolean = true,
    maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1,
    onTextLayout: ((TextLayoutResult) -> Unit)? = null,
    style: TextStyle = LocalTextStyle.current
) {
    androidx.compose.material3.Text(
        AppLanguage.translate(text), modifier, color, fontSize, fontStyle, fontWeight, fontFamily, letterSpacing,
        textDecoration, textAlign, lineHeight, overflow, softWrap, maxLines, minLines, onTextLayout, style
    )
}

/** AnnotatedString variant (already-built text such as labels with a coloured marker); not translated. */
@Composable
fun Text(
    text: androidx.compose.ui.text.AnnotatedString,
    modifier: Modifier = Modifier,
    color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified,
    fontStyle: FontStyle? = null,
    fontWeight: FontWeight? = null,
    letterSpacing: TextUnit = TextUnit.Unspecified,
    textAlign: TextAlign? = null,
    lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip,
    maxLines: Int = Int.MAX_VALUE,
    style: TextStyle = LocalTextStyle.current
) {
    androidx.compose.material3.Text(
        text = text, modifier = modifier, color = color, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight,
        letterSpacing = letterSpacing, textAlign = textAlign, lineHeight = lineHeight, overflow = overflow, maxLines = maxLines, style = style
    )
}

/** A translation rule for strings that embed a name or number. */
class Pattern(val regex: Regex, val render: (MatchResult, String) -> String)

object Translations {
    private fun p(regex: String, fa: (MatchResult) -> String, ar: (MatchResult) -> String) =
        Pattern(Regex(regex, RegexOption.DOT_MATCHES_ALL)) { m, lang -> if (lang == "fa") fa(m) else ar(m) }

    private fun word(s: String, lang: String) = (if (lang == "fa") fa else ar)[s] ?: s

    val patterns = listOf(
        p("Created (.+)", { "ایجاد شده در ${it.groupValues[1]}" }, { "أُنشئت في ${it.groupValues[1]}" }),
        p("Add (\\d+) (?:member|members)", { "افزودن ${it.groupValues[1]} عضو" }, { "إضافة ${it.groupValues[1]} أعضاء" }),
        p("Couldn't add (.+): (.+)", { "افزودن ${it.groupValues[1]} ممکن نبود: ${it.groupValues[2]}" }, { "تعذّرت إضافة ${it.groupValues[1]}: ${it.groupValues[2]}" }),
        p("(\\d+) min ago", { "${it.groupValues[1]} دقیقه پیش" }, { "منذ ${it.groupValues[1]} د" }),
        p("(\\d+) h ago", { "${it.groupValues[1]} ساعت پیش" }, { "منذ ${it.groupValues[1]} س" }),
        p("(\\d+) d ago", { "${it.groupValues[1]} روز پیش" }, { "منذ ${it.groupValues[1]} ي" }),
        p("Too many attempts\\. Try again in (\\d+) s", { "تلاش‌های زیاد. ${it.groupValues[1]} ثانیه دیگر دوباره امتحان کنید" }, { "محاولات كثيرة. حاول مجددًا بعد ${it.groupValues[1]} ث" }),
        p("Sign (.+) out of your account\\?", { "${it.groupValues[1]} از حساب شما خارج شود؟" }, { "هل تريد تسجيل خروج ${it.groupValues[1]} من حسابك؟" }),
        p("(\\d+) members", { "${it.groupValues[1]} عضو" }, { "${it.groupValues[1]} أعضاء" }),
        p("(\\d+) in call", { "${it.groupValues[1]} نفر در تماس" }, { "${it.groupValues[1]} في المكالمة" }),
        p("(Private|Public) · (\\d+) members",
            { "${if (it.groupValues[1] == "Private") "خصوصی" else "عمومی"} · ${it.groupValues[2]} عضو" },
            { "${if (it.groupValues[1] == "Private") "خاصة" else "عامة"} · ${it.groupValues[2]} أعضاء" }),
        p("(OWNER|ADMIN|MEMBER) — (\\d+)", { "${word(it.groupValues[1], "fa")} — ${it.groupValues[2]}" }, { "${word(it.groupValues[1], "ar")} — ${it.groupValues[2]}" }),
        p("Pending \\((\\d+)\\)", { "در انتظار (${it.groupValues[1]})" }, { "قيد الانتظار (${it.groupValues[1]})" }),
        p("Replying to (.+)", { "پاسخ به ${it.groupValues[1]}" }, { "الرد على ${it.groupValues[1]}" }),
        p("Welcome to #(.+)!", { "به #${it.groupValues[1]} خوش آمدید!" }, { "مرحبًا بك في #${it.groupValues[1]}!" }),
        p("This is the start of the #(.+) channel\\.", { "این آغاز کانال #${it.groupValues[1]} است." }, { "هذه بداية قناة #${it.groupValues[1]}." }),
        p("This is the beginning of your direct message history with (.+)\\.",
            { "این آغاز گفتگوی مستقیم شما با ${it.groupValues[1]} است." }, { "هذه بداية محادثتك المباشرة مع ${it.groupValues[1]}." }),
        p("Connecting to: (.+)", { "اتصال به: ${it.groupValues[1]}" }, { "الاتصال بـ: ${it.groupValues[1]}" }),
        p("Start a Whisper with (.+)", { "شروع نجوا با ${it.groupValues[1]}" }, { "بدء همسة مع ${it.groupValues[1]}" }),
        p("(.+) wants to start an end-to-end encrypted Whisper\\. Nothing is stored on the server\\.",
            { "${it.groupValues[1]} می‌خواهد یک نجوای رمزنگاری‌شدهٔ سرتاسری شروع کند. چیزی روی سرور ذخیره نمی‌شود." },
            { "${it.groupValues[1]} يريد بدء همسة مشفرة من طرف إلى طرف. لا يتم تخزين أي شيء على الخادم." }),
        p("Waiting for (.+) to accept…", { "در انتظار پذیرش ${it.groupValues[1]}…" }, { "في انتظار قبول ${it.groupValues[1]}…" }),
        p("If this matches the number on (.+)'s device, nobody is intercepting your Whisper\\.",
            { "اگر با عدد دستگاه ${it.groupValues[1]} یکسان است، کسی نجوای شما را شنود نمی‌کند." },
            { "إذا تطابق هذا مع الرقم على جهاز ${it.groupValues[1]}، فلا أحد يتنصت على همستك." }),
        p("Friend request sent to (.+)\\.", { "درخواست دوستی برای ${it.groupValues[1]} ارسال شد." }, { "تم إرسال طلب الصداقة إلى ${it.groupValues[1]}." }),
        p("Voice message · (.+)", { "پیام صوتی · ${it.groupValues[1]}" }, { "رسالة صوتية · ${it.groupValues[1]}" }),
        p("Recording\\s+(.+)", { "در حال ضبط  ${it.groupValues[1]}" }, { "جارٍ التسجيل  ${it.groupValues[1]}" }),
        p("Sent a file: (.+)", { "فایل فرستاد: ${it.groupValues[1]}" }, { "أرسل ملفًا: ${it.groupValues[1]}" }),
        p("You: (.*)", { "شما: ${it.groupValues[1].let(::t)}" }, { "أنت: ${it.groupValues[1].let(::t)}" }),
        p("Sent a (voice|video) message \\(play it on the web or desktop client\\)",
            { "پیام ${if (it.groupValues[1] == "voice") "صوتی" else "ویدیویی"} فرستاد (در نسخهٔ وب یا دسکتاپ پخش کنید)" },
            { "أرسل رسالة ${if (it.groupValues[1] == "voice") "صوتية" else "فيديو"} (شغّلها على الويب أو سطح المكتب)" }),
        p("Sent a (photo|file|voice message|video message)",
            { "${mapOf("photo" to "عکس", "file" to "فایل", "voice message" to "پیام صوتی", "video message" to "پیام ویدیویی")[it.groupValues[1]]} فرستاد" },
            { "أرسل ${mapOf("photo" to "صورة", "file" to "ملفًا", "voice message" to "رسالة صوتية", "video message" to "رسالة فيديو")[it.groupValues[1]]}" })
    )

    val fa: Map<String, String> = mapOf(
        "ADMIN" to "مدیر", "OWNER" to "مالک", "MEMBER" to "عضو",
        "Accept" to "پذیرفتن", "Action failed." to "عملیات ناموفق بود.", "Add a friend" to "افزودن دوست", "Add attachment" to "افزودن پیوست",
        "Add emoji" to "افزودن ایموجی", "Add members" to "افزودن اعضا", "Add" to "افزودن", "Added" to "اضافه شد",
        "Allow notifications" to "اجازهٔ اعلان‌ها", "Allow" to "اجازه", "Allowed" to "مجاز", "Already have an account?" to "حساب کاربری دارید؟",
        "Android notification permission is off." to "مجوز اعلان‌های اندروید خاموش است.", "Appearance" to "ظاهر", "Arabic" to "عربی",
        "Authentication failed." to "احراز هویت ناموفق بود.", "Auto" to "خودکار", "Back" to "بازگشت", "Blocked" to "مسدود",
        "Cached data" to "داده‌های ذخیره‌شده", "Camera" to "دوربین", "Cancel recording" to "لغو ضبط", "Cancel" to "لغو",
        "Change photo" to "تغییر عکس", "Change" to "تغییر", "Channel Name" to "نام کانال", "Channel name" to "نام کانال", "Channel Settings" to "تنظیمات کانال",
        "Channel key not available yet. Try again in a moment." to "کلید کانال هنوز در دسترس نیست. کمی بعد دوباره تلاش کنید.",
        "Channel" to "کانال", "Choose who can reach you. Changes save immediately." to "تعیین کنید چه کسی می‌تواند با شما تماس بگیرد. تغییرات بلافاصله ذخیره می‌شوند.",
        "Clear" to "پاک کردن", "Close" to "بستن", "Connect" to "اتصال", "Connected" to "متصل", "Connecting…" to "در حال اتصال…",
        "Continue" to "ادامه", "Copy" to "کپی", "Couldn't change status." to "تغییر وضعیت ممکن نشد.", "Couldn't delete the message." to "حذف پیام ممکن نشد.",
        "Couldn't download or decrypt the file." to "دانلود یا رمزگشایی فایل ممکن نشد.", "Couldn't leave the channel." to "ترک کانال ممکن نشد.",
        "Couldn't load image" to "بارگذاری تصویر ممکن نشد", "Couldn't load the video message." to "بارگذاری پیام ویدیویی ممکن نشد.",
        "Couldn't load the voice message." to "بارگذاری پیام صوتی ممکن نشد.", "Couldn't save." to "ذخیره ممکن نشد.",
        "Couldn't send the video." to "ارسال ویدیو ممکن نشد.", "Couldn't send the voice message." to "ارسال پیام صوتی ممکن نشد.",
        "Couldn't send. Check your connection and try again." to "ارسال ممکن نشد. اتصال خود را بررسی کنید و دوباره تلاش کنید.",
        "Couldn't start the microphone." to "راه‌اندازی میکروفون ممکن نشد.", "Couldn't update your photo." to "به‌روزرسانی عکس ممکن نشد.",
        "Couldn't send the file." to "ارسال فایل ممکن نشد.", "Couldn't read the selected file." to "خواندن فایل انتخاب‌شده ممکن نشد.",
        "Create an account" to "ایجاد حساب کاربری", "Create" to "ایجاد", "Current password" to "گذرواژهٔ فعلی", "Custom status" to "وضعیت دلخواه",
        "DESCRIPTION " to "توضیحات ", "(optional)" to "(اختیاری)", "Dark" to "تیره", "Data & Storage" to "داده و حافظه", "Decline" to "رد کردن",
        "Delete Channel" to "حذف کانال", "Delete this channel for everyone? This can't be undone." to "این کانال برای همه حذف شود؟ این کار قابل بازگشت نیست.",
        "Delete" to "حذف", "Description" to "توضیحات", "Disappear after 1 hour" to "ناپدید شدن پس از ۱ ساعت", "Disappear after 24 hours" to "ناپدید شدن پس از ۲۴ ساعت",
        "Disappear after 5 minutes" to "ناپدید شدن پس از ۵ دقیقه", "Do Not Disturb" to "مزاحم نشوید", "Echo cancellation" to "حذف اکو", "Edit" to "ویرایش",
        "Editing message" to "ویرایش پیام", "End" to "پایان", "End-to-end encrypted · not stored" to "رمزنگاری سرتاسری · ذخیره نمی‌شود", "English" to "English",
        "Everyone" to "همه", "Explore" to "کاوش", "Failed to connect to server. Check the address and try again." to "اتصال به سرور ناموفق بود. نشانی را بررسی کنید و دوباره تلاش کنید.",
        "File is too large for mobile (max 25 MB)." to "فایل برای موبایل بیش از حد بزرگ است (حداکثر ۲۵ مگابایت).", "File" to "فایل",
        "Filter background noise from your microphone." to "نویز پس‌زمینهٔ میکروفون را فیلتر می‌کند.", "Find a user" to "جستجوی کاربر", "Friends only" to "فقط دوستان",
        "Friends" to "دوستان", "GROUPS" to "گروه‌ها", "Hidden from Explore." to "در کاوش نمایش داده نمی‌شود.", "Hide password" to "پنهان کردن گذرواژه",
        "Messages" to "پیام‌ها", "Incoming calls" to "تماس‌های ورودی", "Background connection" to "اتصال پس‌زمینه", "Reply" to "پاسخ", "Mark as read" to "علامت‌گذاری به‌عنوان خوانده‌شده",
        "Incoming call" to "تماس ورودی", "is calling you…" to "با شما تماس می‌گیرد…", "Answer" to "پاسخ", "Decline" to "رد",
        "Stay connected in the background" to "اتصال در پس‌زمینه", "Keeps a quiet notification so messages and incoming calls reach you even when Cove is closed." to "با یک اعلان بی‌صدا، پیام‌ها و تماس‌ها حتی با بسته بودن Cove به شما می‌رسند.",
        "There is no push service on a self-hosted server, so Cove keeps its own connection open to notify you." to "سرور شخصی سرویس پوش ندارد؛ بنابراین Cove اتصال خودش را برای اطلاع‌رسانی باز نگه می‌دارد.",
        "Copied" to "کپی شد", "No members found" to "عضوی پیدا نشد",
        "Idle" to "غیرفعال","Invisible" to "نامرئی", "Invite link copied" to "پیوند دعوت کپی شد", "Invite link" to "پیوند دعوت",
        "Join Cove and start chatting." to "به Cove بپیوندید و گفتگو را شروع کنید.", "Join calls muted" to "ورود به تماس با میکروفون بسته",
        "Join with invite link" to "پیوستن با پیوند دعوت", "Join" to "پیوستن", "Keep until closed" to "نگه‌داشتن تا بسته شدن", "LANGUAGE" to "زبان",
        "Leave Channel" to "ترک کانال", "Leave call" to "ترک تماس", "Light" to "روشن", "Log In" to "ورود", "Log Out" to "خروج از حساب",
        "Make admin" to "ارتقا به مدیر", "Members" to "اعضا", "Message notifications" to "اعلان پیام‌ها", "Message..." to "پیام...", "Message" to "پیام",
        "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to." to "پیام‌ها فقط در حافظهٔ هر دو دستگاه هستند. برای اطمینان از هویت مخاطب، عدد ایمنی را مقایسه کنید.",
        "Microphone" to "میکروفون", "More languages are coming to mobile soon." to "زبان‌های بیشتر به‌زودی به موبایل اضافه می‌شوند.", "Mute" to "بی‌صدا",
        "My Account" to "حساب من", "COVE IS OPEN SOURCE" to "COVE متن‌باز است", "Need an account? " to "حساب کاربری ندارید؟ ", "New Conversation" to "گفتگوی جدید",
        "New conversation" to "گفتگوی جدید", "New password (min 8 characters)" to "گذرواژهٔ جدید (حداقل ۸ نویسه)", "No app can open this file." to "هیچ برنامه‌ای نمی‌تواند این فایل را باز کند.",
        "No camera app available." to "برنامهٔ دوربین در دسترس نیست.", "No conversations. Click + to start!" to "گفتگویی وجود ندارد. برای شروع + را بزنید!",
        "No friends yet. Search above to add someone." to "هنوز دوستی ندارید. از بالا جستجو کنید و کسی را اضافه کنید.", "No outgoing requests." to "درخواست ارسالی‌ای وجود ندارد.",
        "No pending requests." to "درخواستی در انتظار نیست.", "No public channels found." to "کانال عمومی‌ای یافت نشد.", "Nobody" to "هیچ‌کس",
        "Cove Client" to "Cove", "Noise suppression" to "حذف نویز", "Not connected. Try again." to "متصل نیستید. دوباره تلاش کنید.", "Not loaded" to "بارگذاری نشده",
        "Notifications" to "اعلان‌ها", "Offline" to "آفلاین", "Online status" to "وضعیت آنلاین", "Online" to "آنلاین", "Only invited members can find and join." to "فقط اعضای دعوت‌شده می‌توانند آن را پیدا کنند و بپیوندند.",
        "Opened attachments are decrypted into a private cache on this device. Messages and keys are never stored here." to "پیوست‌های بازشده در حافظهٔ خصوصی این دستگاه رمزگشایی می‌شوند. پیام‌ها و کلیدها هرگز اینجا ذخیره نمی‌شوند.",
        "Original message" to "پیام اصلی", "Password updated" to "گذرواژه به‌روز شد", "Password" to "گذرواژه", "Paste an invite link" to "پیوند دعوت را جای‌گذاری کنید",
        "Pause" to "توقف", "Pending" to "در انتظار", "Permissions" to "مجوزها", "Persian" to "فارسی", "Photo" to "عکس", "Play a sound with each notification." to "با هر اعلان صدایی پخش شود.",
        "Play video" to "پخش ویدیو", "Play" to "پخش", "Please enter both username and password." to "لطفاً نام کاربری و گذرواژه را وارد کنید.",
        "Prevent your speakers from feeding back into the call." to "از بازگشت صدای بلندگو به تماس جلوگیری می‌کند.", "Privacy & Safety" to "حریم خصوصی و امنیت",
        "Private Channel" to "کانال خصوصی", "Private channel" to "کانال خصوصی", "Private" to "خصوصی", "Profile saved" to "نمایه ذخیره شد", "Public channels" to "کانال‌های عمومی", "Public" to "عمومی",
        "Record video message" to "ضبط پیام ویدیویی", "Record voice message" to "ضبط پیام صوتی", "Recording too short." to "ضبط بیش از حد کوتاه است.", "Register" to "ثبت‌نام",
        "Remove admin" to "حذف مدیریت", "Remove from channel" to "حذف از کانال", "Remove" to "حذف", "Reply" to "پاسخ", "SERVER ADDRESS" to "نشانی سرور", "Safety number" to "عدد ایمنی",
        "Save changes" to "ذخیرهٔ تغییرات", "Save profile" to "ذخیرهٔ نمایه", "Search by username" to "جستجو با نام کاربری", "Search channels" to "جستجوی کانال‌ها", "Search" to "جستجو",
        "Search..." to "جستجو...", "Select a Server" to "انتخاب سرور", "Send message" to "ارسال پیام", "Send voice message" to "ارسال پیام صوتی", "Send" to "ارسال",
        "Session only (nothing kept)" to "فقط همین نشست (چیزی نگه داشته نمی‌شود)", "Settings" to "تنظیمات", "Show Members" to "نمایش اعضا",
        "Show a notification for new messages while the app is in the background." to "وقتی برنامه در پس‌زمینه است برای پیام‌های جدید اعلان نشان بده.", "Show password" to "نمایش گذرواژه",
        "Sound" to "صدا", "Start Voice Call" to "شروع تماس صوتی", "Start Whisper" to "شروع نجوا", "Start every call with your microphone off." to "هر تماس را با میکروفون خاموش شروع کن.", "Start" to "شروع",
        "Successfully connected!" to "با موفقیت متصل شد!", "THEME" to "پوسته", "That file isn't a supported image." to "این فایل تصویر پشتیبانی‌شده‌ای نیست.", "This Whisper has ended." to "این نجوا پایان یافت.",
        "This audio format can't be played." to "این قالب صوتی قابل پخش نیست.", "This section isn't available on mobile yet." to "این بخش هنوز در موبایل موجود نیست.", "This video can't be played." to "این ویدیو قابل پخش نیست.",
        "Today" to "امروز", "USER SETTINGS" to "تنظیمات کاربر", "Unblock" to "رفع مسدودی", "Unknown" to "ناشناس", "Update password" to "به‌روزرسانی گذرواژه", "Uploading…" to "در حال بارگذاری…",
        "Use your keyboard's emoji picker." to "از انتخابگر ایموجی صفحه‌کلید استفاده کنید.", "Username" to "نام کاربری", "Video message" to "پیام ویدیویی", "Voice & Video" to "صدا و تصویر",
        "We're so excited to see you again!" to "از دیدن دوبارهٔ شما بسیار خوشحالیم!", "Welcome back!" to "خوش آمدید!", "What is this channel about?" to "این کانال دربارهٔ چیست؟", "What's on your mind?" to "به چه فکر می‌کنید؟",
        "Where are we heading today?" to "امروز به کجا می‌رویم؟", "Whisper request" to "درخواست نجوا", "Whisper" to "نجوا",
        "Whispers are end-to-end encrypted and never stored on the server. Both of you must be online and friends." to "نجواها رمزنگاری سرتاسری دارند و هرگز روی سرور ذخیره نمی‌شوند. هر دو باید آنلاین و دوست باشید.",
        "Whisper…" to "نجوا…", "Who can add me to channels" to "چه کسی می‌تواند مرا به کانال‌ها اضافه کند", "Who can message me" to "چه کسی می‌تواند به من پیام دهد",
        "Who can send me friend requests" to "چه کسی می‌تواند درخواست دوستی بفرستد", "Yes, delete" to "بله، حذف شود", "Yesterday" to "دیروز", "You haven't blocked anyone." to "هیچ‌کس را مسدود نکرده‌اید.",
        "You" to "شما", "(edited)" to "(ویرایش‌شده)", "Cove stores your messages securely, but relies on the server for key management. Ensure you trust the host before sending sensitive data" to
            "Cove پیام‌های شما را به‌صورت امن ذخیره می‌کند اما برای مدیریت کلیدها به سرور وابسته است. پیش از ارسال اطلاعات حساس مطمئن شوید به میزبان اعتماد دارید.",
        "Not connected to the server." to "به سرور متصل نیستید.", "Offline" to "آفلاین", "Back to chats" to "بازگشت به گفتگوها",
        "Attachments aren't available on mobile yet." to "پیوست‌ها هنوز در موبایل موجودند.", "Cancel recording" to "لغو ضبط", "Create an account" to "ایجاد حساب کاربری",
        "Couldn't read the image." to "خواندن تصویر ممکن نشد.", "Sent" to "ارسال شد", "Attach" to "پیوست", "Chat" to "گفتگو", "Close" to "بستن", "Change password" to "تغییر گذرواژه",
        "Cancel" to "لغو", "Waiting…" to "در انتظار…", "Safety number" to "عدد ایمنی", "Your request was declined." to "درخواست شما رد شد.", "The other person ended the session." to "طرف مقابل نشست را پایان داد.",
        "Couldn't establish the encrypted session." to "برقراری نشست رمزنگاری‌شده ممکن نشد."
    ) + ExtraFa + AdminFa

    val ar: Map<String, String> = mapOf(
        "ADMIN" to "مشرف", "OWNER" to "المالك", "MEMBER" to "عضو",
        "Accept" to "قبول", "Action failed." to "فشلت العملية.", "Add a friend" to "إضافة صديق", "Add attachment" to "إضافة مرفق",
        "Add emoji" to "إضافة رمز تعبيري", "Add members" to "إضافة أعضاء", "Add" to "إضافة", "Added" to "تمت الإضافة",
        "Allow notifications" to "السماح بالإشعارات", "Allow" to "السماح", "Allowed" to "مسموح", "Already have an account?" to "لديك حساب بالفعل؟",
        "Android notification permission is off." to "إذن إشعارات أندرويد معطل.", "Appearance" to "المظهر", "Arabic" to "العربية",
        "Authentication failed." to "فشلت المصادقة.", "Auto" to "تلقائي", "Back" to "رجوع", "Blocked" to "محظورون",
        "Cached data" to "البيانات المخزنة", "Camera" to "الكاميرا", "Cancel recording" to "إلغاء التسجيل", "Cancel" to "إلغاء",
        "Change photo" to "تغيير الصورة", "Change" to "تغيير", "Channel Name" to "اسم القناة", "Channel name" to "اسم القناة", "Channel Settings" to "إعدادات القناة",
        "Channel key not available yet. Try again in a moment." to "مفتاح القناة غير متاح بعد. حاول مرة أخرى بعد قليل.",
        "Channel" to "قناة", "Choose who can reach you. Changes save immediately." to "اختر من يمكنه التواصل معك. تُحفظ التغييرات فورًا.",
        "Clear" to "مسح", "Close" to "إغلاق", "Connect" to "اتصال", "Connected" to "متصل", "Connecting…" to "جارٍ الاتصال…",
        "Continue" to "متابعة", "Copy" to "نسخ", "Couldn't change status." to "تعذر تغيير الحالة.", "Couldn't delete the message." to "تعذر حذف الرسالة.",
        "Couldn't download or decrypt the file." to "تعذر تنزيل الملف أو فك تشفيره.", "Couldn't leave the channel." to "تعذرت مغادرة القناة.",
        "Couldn't load image" to "تعذر تحميل الصورة", "Couldn't load the video message." to "تعذر تحميل رسالة الفيديو.",
        "Couldn't load the voice message." to "تعذر تحميل الرسالة الصوتية.", "Couldn't save." to "تعذر الحفظ.",
        "Couldn't send the video." to "تعذر إرسال الفيديو.", "Couldn't send the voice message." to "تعذر إرسال الرسالة الصوتية.",
        "Couldn't send. Check your connection and try again." to "تعذر الإرسال. تحقق من اتصالك وحاول مرة أخرى.",
        "Couldn't start the microphone." to "تعذر تشغيل الميكروفون.", "Couldn't update your photo." to "تعذر تحديث صورتك.",
        "Couldn't send the file." to "تعذر إرسال الملف.", "Couldn't read the selected file." to "تعذرت قراءة الملف المحدد.",
        "Create an account" to "إنشاء حساب", "Create" to "إنشاء", "Current password" to "كلمة المرور الحالية", "Custom status" to "حالة مخصصة",
        "DESCRIPTION " to "الوصف ", "(optional)" to "(اختياري)", "Dark" to "داكن", "Data & Storage" to "البيانات والتخزين", "Decline" to "رفض",
        "Delete Channel" to "حذف القناة", "Delete this channel for everyone? This can't be undone." to "حذف هذه القناة للجميع؟ لا يمكن التراجع عن ذلك.",
        "Delete" to "حذف", "Description" to "الوصف", "Disappear after 1 hour" to "تختفي بعد ساعة", "Disappear after 24 hours" to "تختفي بعد 24 ساعة",
        "Disappear after 5 minutes" to "تختفي بعد 5 دقائق", "Do Not Disturb" to "عدم الإزعاج", "Echo cancellation" to "إلغاء الصدى", "Edit" to "تعديل",
        "Editing message" to "تعديل الرسالة", "End" to "إنهاء", "End-to-end encrypted · not stored" to "مشفرة من طرف إلى طرف · غير مخزنة", "English" to "English",
        "Everyone" to "الجميع", "Explore" to "استكشاف", "Failed to connect to server. Check the address and try again." to "فشل الاتصال بالخادم. تحقق من العنوان وحاول مرة أخرى.",
        "File is too large for mobile (max 25 MB)." to "الملف كبير جدًا للجوال (الحد الأقصى 25 ميغابايت).", "File" to "ملف",
        "Filter background noise from your microphone." to "تصفية ضوضاء الخلفية من الميكروفون.", "Find a user" to "البحث عن مستخدم", "Friends only" to "الأصدقاء فقط",
        "Friends" to "الأصدقاء", "GROUPS" to "المجموعات", "Hidden from Explore." to "مخفية من الاستكشاف.", "Hide password" to "إخفاء كلمة المرور",
        "Messages" to "الرسائل", "Incoming calls" to "المكالمات الواردة", "Background connection" to "الاتصال في الخلفية", "Reply" to "رد", "Mark as read" to "تعليم كمقروء",
        "Incoming call" to "مكالمة واردة", "is calling you…" to "يتصل بك…", "Answer" to "إجابة", "Decline" to "رفض",
        "Stay connected in the background" to "البقاء متصلاً في الخلفية", "Keeps a quiet notification so messages and incoming calls reach you even when Cove is closed." to "يُبقي إشعارًا هادئًا ليصلك الرسائل والمكالمات حتى عند إغلاق Cove.",
        "There is no push service on a self-hosted server, so Cove keeps its own connection open to notify you." to "لا يوجد خدمة دفع على الخادم المستضاف ذاتيًا، لذا يُبقي Cove اتصاله مفتوحًا لإشعارك.",
        "Copied" to "تم النسخ", "No members found" to "لم يتم العثور على أعضاء",
        "Idle" to "خامل","Invisible" to "غير مرئي", "Invite link copied" to "تم نسخ رابط الدعوة", "Invite link" to "رابط الدعوة",
        "Join Cove and start chatting." to "انضم إلى Cove وابدأ المحادثة.", "Join calls muted" to "الانضمام للمكالمات والميكروفون مكتوم",
        "Join with invite link" to "الانضمام برابط دعوة", "Join" to "انضمام", "Keep until closed" to "الاحتفاظ حتى الإغلاق", "LANGUAGE" to "اللغة",
        "Leave Channel" to "مغادرة القناة", "Leave call" to "مغادرة المكالمة", "Light" to "فاتح", "Log In" to "تسجيل الدخول", "Log Out" to "تسجيل الخروج",
        "Make admin" to "ترقية إلى مشرف", "Members" to "الأعضاء", "Message notifications" to "إشعارات الرسائل", "Message..." to "رسالة...", "Message" to "رسالة",
        "Messages here exist only in memory on both devices. Compare the safety number to verify who you're talking to." to "الرسائل هنا موجودة في ذاكرة الجهازين فقط. قارن رقم الأمان للتحقق ممن تحادثه.",
        "Microphone" to "الميكروفون", "More languages are coming to mobile soon." to "ستتوفر لغات أخرى على الجوال قريبًا.", "Mute" to "كتم",
        "My Account" to "حسابي", "COVE IS OPEN SOURCE" to "COVE مفتوح المصدر", "Need an account? " to "تحتاج إلى حساب؟ ", "New Conversation" to "محادثة جديدة",
        "New conversation" to "محادثة جديدة", "New password (min 8 characters)" to "كلمة مرور جديدة (8 أحرف على الأقل)", "No app can open this file." to "لا يوجد تطبيق يمكنه فتح هذا الملف.",
        "No camera app available." to "لا يوجد تطبيق كاميرا متاح.", "No conversations. Click + to start!" to "لا توجد محادثات. اضغط + للبدء!",
        "No friends yet. Search above to add someone." to "لا أصدقاء بعد. ابحث بالأعلى لإضافة أحد.", "No outgoing requests." to "لا توجد طلبات مرسلة.",
        "No pending requests." to "لا توجد طلبات معلقة.", "No public channels found." to "لم يتم العثور على قنوات عامة.", "Nobody" to "لا أحد",
        "Cove Client" to "Cove", "Noise suppression" to "كتم الضوضاء", "Not connected. Try again." to "غير متصل. حاول مرة أخرى.", "Not loaded" to "غير محمّلة",
        "Notifications" to "الإشعارات", "Offline" to "غير متصل", "Online status" to "حالة الاتصال", "Online" to "متصل", "Only invited members can find and join." to "يمكن للأعضاء المدعوين فقط العثور عليها والانضمام.",
        "Opened attachments are decrypted into a private cache on this device. Messages and keys are never stored here." to "تُفك المرفقات المفتوحة في ذاكرة مؤقتة خاصة على هذا الجهاز. لا تُخزَّن الرسائل والمفاتيح هنا أبدًا.",
        "Original message" to "الرسالة الأصلية", "Password updated" to "تم تحديث كلمة المرور", "Password" to "كلمة المرور", "Paste an invite link" to "الصق رابط الدعوة",
        "Pause" to "إيقاف مؤقت", "Pending" to "قيد الانتظار", "Permissions" to "الأذونات", "Persian" to "الفارسية", "Photo" to "صورة", "Play a sound with each notification." to "تشغيل صوت مع كل إشعار.",
        "Play video" to "تشغيل الفيديو", "Play" to "تشغيل", "Please enter both username and password." to "يرجى إدخال اسم المستخدم وكلمة المرور.",
        "Prevent your speakers from feeding back into the call." to "منع رجوع صوت السماعات إلى المكالمة.", "Privacy & Safety" to "الخصوصية والأمان",
        "Private Channel" to "قناة خاصة", "Private channel" to "قناة خاصة", "Private" to "خاصة", "Profile saved" to "تم حفظ الملف الشخصي", "Public channels" to "القنوات العامة", "Public" to "عامة",
        "Record video message" to "تسجيل رسالة فيديو", "Record voice message" to "تسجيل رسالة صوتية", "Recording too short." to "التسجيل قصير جدًا.", "Register" to "إنشاء حساب",
        "Remove admin" to "إزالة الإشراف", "Remove from channel" to "إزالة من القناة", "Remove" to "إزالة", "Reply" to "رد", "SERVER ADDRESS" to "عنوان الخادم", "Safety number" to "رقم الأمان",
        "Save changes" to "حفظ التغييرات", "Save profile" to "حفظ الملف الشخصي", "Search by username" to "البحث باسم المستخدم", "Search channels" to "البحث في القنوات", "Search" to "بحث",
        "Search..." to "بحث...", "Select a Server" to "اختر خادمًا", "Send message" to "إرسال الرسالة", "Send voice message" to "إرسال رسالة صوتية", "Send" to "إرسال",
        "Session only (nothing kept)" to "للجلسة فقط (لا يُحتفظ بشيء)", "Settings" to "الإعدادات", "Show Members" to "عرض الأعضاء",
        "Show a notification for new messages while the app is in the background." to "إظهار إشعار للرسائل الجديدة عندما يكون التطبيق في الخلفية.", "Show password" to "إظهار كلمة المرور",
        "Sound" to "الصوت", "Start Voice Call" to "بدء مكالمة صوتية", "Start Whisper" to "بدء همسة", "Start every call with your microphone off." to "ابدأ كل مكالمة والميكروفون مغلق.", "Start" to "بدء",
        "Successfully connected!" to "تم الاتصال بنجاح!", "THEME" to "السمة", "That file isn't a supported image." to "هذا الملف ليس صورة مدعومة.", "This Whisper has ended." to "انتهت هذه الهمسة.",
        "This audio format can't be played." to "لا يمكن تشغيل هذه الصيغة الصوتية.", "This section isn't available on mobile yet." to "هذا القسم غير متاح على الجوال بعد.", "This video can't be played." to "لا يمكن تشغيل هذا الفيديو.",
        "Today" to "اليوم", "USER SETTINGS" to "إعدادات المستخدم", "Unblock" to "إلغاء الحظر", "Unknown" to "غير معروف", "Update password" to "تحديث كلمة المرور", "Uploading…" to "جارٍ الرفع…",
        "Use your keyboard's emoji picker." to "استخدم لوحة الرموز التعبيرية في لوحة المفاتيح.", "Username" to "اسم المستخدم", "Video message" to "رسالة فيديو", "Voice & Video" to "الصوت والفيديو",
        "We're so excited to see you again!" to "يسعدنا جدًا رؤيتك مجددًا!", "Welcome back!" to "مرحبًا بعودتك!", "What is this channel about?" to "ما موضوع هذه القناة؟", "What's on your mind?" to "ما الذي يدور في بالك؟",
        "Where are we heading today?" to "إلى أين نتجه اليوم؟", "Whisper request" to "طلب همسة", "Whisper" to "همسة",
        "Whispers are end-to-end encrypted and never stored on the server. Both of you must be online and friends." to "الهمسات مشفرة من طرف إلى طرف ولا تُخزَّن على الخادم أبدًا. يجب أن تكونا متصلين وصديقين.",
        "Whisper…" to "همسة…", "Who can add me to channels" to "من يمكنه إضافتي إلى القنوات", "Who can message me" to "من يمكنه مراسلتي",
        "Who can send me friend requests" to "من يمكنه إرسال طلبات صداقة إليّ", "Yes, delete" to "نعم، احذف", "Yesterday" to "أمس", "You haven't blocked anyone." to "لم تحظر أحدًا.",
        "You" to "أنت", "(edited)" to "(معدّلة)", "Cove stores your messages securely, but relies on the server for key management. Ensure you trust the host before sending sensitive data" to
            "يخزّن Cove رسائلك بأمان لكنه يعتمد على الخادم لإدارة المفاتيح. تأكد من ثقتك بالمضيف قبل إرسال بيانات حساسة.",
        "Not connected to the server." to "غير متصل بالخادم.",
        "Attachments aren't available on mobile yet." to "المرفقات غير متاحة على الجوال بعد.",
        "Couldn't read the image." to "تعذرت قراءة الصورة.", "Sent" to "تم الإرسال", "Attach" to "إرفاق", "Chat" to "محادثة", "Change password" to "تغيير كلمة المرور",
        "Waiting…" to "في الانتظار…", "Your request was declined." to "تم رفض طلبك.", "The other person ended the session." to "أنهى الطرف الآخر الجلسة.",
        "Couldn't establish the encrypted session." to "تعذر إنشاء الجلسة المشفرة."
    ) + ExtraAr + AdminAr
}
