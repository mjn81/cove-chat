import * as React from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { parseMarkdown, type BlockNode, type InlineNode, type MarkdownMode } from '@/lib/markdown';

export interface MarkdownTextProps {
	/** Raw source text. */
	text: string;
	/** `chat` for messages (default), `document` for release notes. */
	mode?: MarkdownMode;
	className?: string;
	/** Renders a plain text run; chat uses it to turn emoji and `:shortcodes:` into images. */
	renderPlain?: (value: string, key: React.Key) => React.ReactNode;
	/** Renders an `@mention`; when omitted mentions are styled text. */
	renderMention?: (value: string, key: React.Key) => React.ReactNode;
}

/** Copies [value] to the clipboard, resolving to whether it worked (it can be denied or unavailable). */
async function copyText(value: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(value);
		return true;
	} catch {
		return false;
	}
}

/**
 * Fenced code block with a copy button. The text stays selectable, so it can be copied by hand too.
 *
 * @param value - Code to show and copy.
 * @param lang - Optional language label from the fence.
 */
export const CodeBlock: React.FC<{ value: string; lang?: string }> = ({ value, lang }) => {
	const { t } = useTranslation();
	const [copied, setCopied] = React.useState(false);

	React.useEffect(() => {
		if (!copied) return;
		const id = setTimeout(() => setCopied(false), 1400);
		return () => clearTimeout(id);
	}, [copied]);

	return (
		<div className="group/code relative my-1 overflow-hidden rounded-md border border-border bg-muted text-start" dir="ltr">
			<div className="flex items-center justify-between gap-2 px-2.5 pt-1 text-[11px] text-muted-foreground select-none">
				<span className="truncate">{lang || ''}</span>
				<button
					type="button"
					onClick={async (e) => {
						e.stopPropagation();
						if (await copyText(value)) setCopied(true);
					}}
					onMouseDown={(e) => e.stopPropagation()}
					aria-label={t('chat.copy_code')}
					title={t('chat.copy_code')}
					className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
				>
					{copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
					<span>{copied ? t('chat.copied') : t('chat.copy_code')}</span>
				</button>
			</div>
			<pre className="m-0 overflow-x-auto px-2.5 pb-2 pt-1 font-mono text-[13px] leading-[18px] whitespace-pre select-text">
				<code>{value}</code>
			</pre>
		</div>
	);
};

function renderInline(
	nodes: InlineNode[],
	props: Pick<MarkdownTextProps, 'renderPlain' | 'renderMention'>,
	keyPrefix = '',
): React.ReactNode[] {
	return nodes.map((n, i) => {
		const key = `${keyPrefix}${i}`;
		switch (n.type) {
			case 'text':
				return props.renderPlain ? props.renderPlain(n.value, key) : <React.Fragment key={key}>{n.value}</React.Fragment>;
			case 'code':
				return (
					<code key={key} className="rounded bg-muted px-1 py-px font-mono text-[0.9em] whitespace-pre-wrap" dir="ltr">
						{n.value}
					</code>
				);
			case 'bold':
				return <strong key={key} className="font-semibold">{renderInline(n.children, props, `${key}.`)}</strong>;
			case 'italic':
				return <em key={key}>{renderInline(n.children, props, `${key}.`)}</em>;
			case 'strike':
				return <del key={key}>{renderInline(n.children, props, `${key}.`)}</del>;
			case 'link':
				// noopener/noreferrer: the target page must not reach window.opener or learn which chat linked it.
				return (
					<a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline break-words">
						{renderInline(n.children, props, `${key}.`)}
					</a>
				);
			case 'url':
			case 'email':
				return (
					<a key={key} href={n.href} target="_blank" rel="noopener noreferrer nofollow" className="text-primary hover:underline break-all">
						{n.value}
					</a>
				);
			case 'mention':
				return props.renderMention ? (
					props.renderMention(n.value, key)
				) : (
					<span key={key} className="font-medium text-primary">
						{n.value}
					</span>
				);
		}
	});
}

const HEADING_CLASS: Record<number, string> = {
	1: 'text-lg font-bold mt-3 mb-1.5',
	2: 'text-base font-bold mt-3 mb-1.5',
	3: 'text-[15px] font-semibold mt-2.5 mb-1',
	4: 'text-sm font-semibold mt-2 mb-1',
	5: 'text-sm font-semibold mt-2 mb-1',
	6: 'text-xs font-semibold mt-2 mb-1 text-muted-foreground',
};

function renderBlocks(
	blocks: BlockNode[],
	mode: MarkdownMode,
	props: Pick<MarkdownTextProps, 'renderPlain' | 'renderMention'>,
): React.ReactNode[] {
	return blocks.map((b, i) => {
		switch (b.type) {
			case 'text':
				// Chat text keeps its newlines (the container is whitespace-pre-wrap); documents use real paragraphs.
				return mode === 'document' ? (
					<p key={i} className="my-1.5 whitespace-normal">
						{renderInline(b.children, props)}
					</p>
				) : (
					<React.Fragment key={i}>{renderInline(b.children, props)}</React.Fragment>
				);
			case 'code':
				return <CodeBlock key={i} value={b.value} lang={b.lang} />;
			case 'quote':
				return (
					<blockquote key={i} className="my-1 border-s-[3px] border-primary/60 ps-2.5 text-foreground/80 whitespace-pre-wrap">
						{renderBlocks(b.children, mode, props)}
					</blockquote>
				);
			case 'heading': {
				const Tag = `h${Math.min(b.level, 6)}` as 'h1';
				return (
					<Tag key={i} className={cn('whitespace-normal', HEADING_CLASS[b.level])}>
						{renderInline(b.children, props)}
					</Tag>
				);
			}
			case 'list': {
				const Tag = b.ordered ? 'ol' : 'ul';
				return (
					<Tag
						key={i}
						start={b.ordered ? b.start : undefined}
						className={cn('my-1 ps-5 whitespace-normal', b.ordered ? 'list-decimal' : 'list-disc')}
					>
						{b.items.map((item, j) => (
							<li key={j} className="my-0.5 marker:text-muted-foreground">
								{renderBlocks(item, mode, props)}
							</li>
						))}
					</Tag>
				);
			}
			case 'hr':
				return <hr key={i} className="my-3 border-border" />;
		}
	});
}

/**
 * Renders chat text or release notes as Markdown through React elements only (no HTML injection), with
 * http(s)/mailto links, code blocks with a copy button and selectable text.
 *
 * @param text - Raw source.
 * @param mode - `chat` (default) or `document`.
 */
export const MarkdownText: React.FC<MarkdownTextProps> = React.memo(({ text, mode = 'chat', className, renderPlain, renderMention }) => {
	const blocks = React.useMemo(() => parseMarkdown(text, mode), [text, mode]);
	// `contents` in chat so the text still flows inline with the "(edited)" mark; user-select is inherited either way.
	return (
		<div className={cn('select-text', mode === 'document' ? 'block' : 'contents', className)}>
			{renderBlocks(blocks, mode, { renderPlain, renderMention })}
		</div>
	);
});
MarkdownText.displayName = 'MarkdownText';
