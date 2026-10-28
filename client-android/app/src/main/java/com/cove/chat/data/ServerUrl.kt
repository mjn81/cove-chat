package com.cove.chat.data

private val SCHEME = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://")
private val IPV4 = Regex("""^\d{1,3}(\.\d{1,3}){3}$""")
private val LAN_SUFFIXES = listOf(".local", ".lan", ".internal", ".home.arpa")

/**
 * Turns what the user typed on the connect screen into the ordered list of server origins to probe.
 *
 * A bare public domain ("demo.covechat.dev") tries https first: a server behind a TLS proxy redirects
 * http to https, but a WebSocket upgrade does not survive that redirect, so saving the http form would
 * break chat even though `/api/version` answered. Loopback, IP literals, LAN names and explicit ports try
 * http first. An explicit scheme is respected and is the only candidate; paths and queries are dropped.
 * Mirrors `serverUrlCandidates` in `client-web/src/lib/server-url.ts`.
 *
 * @param raw the address as typed.
 * @return origins to try in order; empty when the input is blank or not a valid host.
 */
fun serverUrlCandidates(raw: String): List<String> {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return emptyList()

    val scheme = SCHEME.find(trimmed)?.groupValues?.get(1)?.lowercase()
    val authority = trimmed.replaceFirst(SCHEME, "").substringBefore('/').substringBefore('?').substringBefore('#')
    if (authority.isEmpty()) return emptyList()

    val host: String
    val port: String
    if (authority.startsWith("[")) {
        val end = authority.indexOf(']')
        if (end < 0) return emptyList()
        host = authority.substring(0, end + 1).lowercase()
        port = authority.substring(end + 1).removePrefix(":")
    } else {
        val colon = authority.lastIndexOf(':')
        host = (if (colon >= 0) authority.substring(0, colon) else authority).lowercase()
        port = if (colon >= 0) authority.substring(colon + 1) else ""
    }
    if (host.isEmpty()) return emptyList()
    val hostPort = if (port.isEmpty()) host else "$host:$port"

    if (scheme == "http" || scheme == "https") return listOf("$scheme://$hostPort")
    if (scheme != null) return emptyList()

    val local = host == "localhost" || host.startsWith("[") || IPV4.matches(host) || !host.contains('.') ||
        LAN_SUFFIXES.any { host.endsWith(it) } || port.isNotEmpty()
    return if (local) listOf("http://$hostPort", "https://$hostPort") else listOf("https://$hostPort", "http://$hostPort")
}
