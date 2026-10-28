package com.cove.chat.ui.components

/**
 * Looks up a web i18n path (`admin.invites.title`) in [AdminEn], translates it to the app language and fills
 * `{name}` placeholders from [args]. Unknown paths come back unchanged.
 */
fun adm(path: String, vararg args: Pair<String, String>): String {
    var text = t(AdminEn[path] ?: return path)
    for ((name, value) in args) text = text.replace("{$name}", value)
    return text
}

/** Like [adm] but returns [fallback] (untranslated) when the path is unknown, for server-defined labels such as setting keys. */
fun admOr(path: String, fallback: String): String = if (AdminEn.containsKey(path)) adm(path) else fallback

/**
 * Turns a backend error into display text. The backend sends i18n keys (`admin.errors.password_invalid`),
 * sometimes followed by `: detail` for validation problems; a message that is not a known key is shown as-is.
 */
fun adminError(raw: String?): String {
    val message = raw.orEmpty()
    val split = message.indexOf(": ")
    val key = if (split < 0) message else message.substring(0, split)
    val detail = if (split < 0) null else message.substring(split + 2)
    val text = when {
        AdminEn.containsKey(key) -> adm(key)
        key.startsWith("admin.") -> adm("admin.errors.generic")
        else -> return t(message)
    }
    return if (detail != null) "$text ($detail)" else text
}
