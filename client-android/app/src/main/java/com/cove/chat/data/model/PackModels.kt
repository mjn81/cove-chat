package com.cove.chat.data.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** One emoji style from `GET /api/emoji/styles` (docs/packs-api.md). URLs are relative to the server. */
@Serializable
data class EmojiStyleInfo(
    val id: String,
    val name: String = "",
    val license: String = "",
    /** Content hash; part of both asset URLs, so a cached sheet for this version never goes stale. */
    val version: String = "",
    @SerialName("cell_size") val cellSize: Int = 64,
    val width: Int = 0,
    val height: Int = 0,
    val count: Int = 0,
    @SerialName("sheet_url") val sheetUrl: String = "",
    @SerialName("index_url") val indexUrl: String = "",
    @SerialName("sheet_bytes") val sheetBytes: Long = 0,
    @SerialName("index_bytes") val indexBytes: Long = 0,
    val default: Boolean = false,
)

@Serializable
data class EmojiStylesResponse(
    @SerialName("default_style") val defaultStyle: String = "noto",
    @SerialName("enabled_styles") val enabledStyles: List<String> = emptyList(),
    val styles: List<EmojiStyleInfo> = emptyList(),
)

@Serializable
data class AnimatedEmojiItem(val sequence: String, val id: String = "", val url: String)

@Serializable
data class AnimatedEmojiResponse(val version: String = "", val items: List<AnimatedEmojiItem> = emptyList())

@Serializable
data class CustomEmojiItem(
    val name: String,
    val url: String,
    @SerialName("file_id") val fileId: String? = null,
    val animated: Boolean = false,
    val width: Int? = null,
    val height: Int? = null,
)

@Serializable
data class CustomEmojiResponse(val version: String = "", val items: List<CustomEmojiItem> = emptyList())

/** One sticker of a pack (`PackItemResponse`). */
@Serializable
data class PackItem(
    val id: String,
    val name: String? = null,
    /** The emoji this sticker is suggested for. */
    val emoji: String? = null,
    val animated: Boolean = false,
    /** Where the image is served, relative to the API base. Use as is. */
    val url: String = "",
    /** Stored image of a server or user sticker (what a sticker message carries); absent for built-in packs. */
    @SerialName("file_id") val fileId: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val bytes: Long = 0,
    val order: Int = 0,
)

/** A sticker pack. List responses leave [items] out and use [itemCount] and [coverUrl]. */
@Serializable
data class Pack(
    val id: String,
    val kind: String = "sticker",
    /** `builtin`, `server` or `user`. */
    val scope: String = "server",
    @SerialName("owner_id") val ownerId: String? = null,
    @SerialName("owner_name") val ownerName: String? = null,
    val name: String = "",
    val description: String? = null,
    val version: String = "",
    val license: String? = null,
    val attribution: String? = null,
    val enabled: Boolean = true,
    val default: Boolean = false,
    val order: Int = 0,
    val animated: Boolean = false,
    val installed: Boolean = false,
    val editable: Boolean = false,
    @SerialName("item_count") val itemCount: Int = 0,
    @SerialName("cover_url") val coverUrl: String? = null,
    val items: List<PackItem>? = null,
)

/** What the caller may still create (`quota` of `GET /api/packs`). */
@Serializable
data class PackQuota(
    @SerialName("user_uploads_enabled") val userUploadsEnabled: Boolean = true,
    @SerialName("max_packs") val maxPacks: Int = 0,
    @SerialName("max_stickers_per_pack") val maxStickersPerPack: Int = 0,
    @SerialName("max_storage_bytes") val maxStorageBytes: Long = 0,
    @SerialName("owned_packs") val ownedPacks: Int = 0,
    @SerialName("used_storage_bytes") val usedStorageBytes: Long = 0,
    @SerialName("sticker_max_bytes") val stickerMaxBytes: Long = 524288,
    @SerialName("sticker_max_side") val stickerMaxSide: Int = 512,
)

@Serializable
data class PackListResponse(
    val items: List<Pack> = emptyList(),
    @SerialName("default_pack_id") val defaultPackId: String? = null,
    val quota: PackQuota = PackQuota(),
)

@Serializable
data class CreatePackRequest(val name: String, val description: String? = null)

@Serializable
data class ItemUploadResponse(val item: PackItem, val pack: Pack)

@Serializable
data class PackOrderRequest(@SerialName("item_ids") val itemIds: List<String>)
