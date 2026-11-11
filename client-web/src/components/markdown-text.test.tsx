import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MarkdownText } from './markdown-text';

describe('MarkdownText', () => {
	it('renders emphasis, code and safe external links', () => {
		const { container } = render(<MarkdownText text={'**bold** and `code` [site](https://example.com)'} />);
		expect(container.querySelector('strong')?.textContent).toBe('bold');
		expect(container.querySelector('code')?.textContent).toBe('code');
		const a = container.querySelector('a');
		expect(a?.getAttribute('href')).toBe('https://example.com');
		expect(a?.getAttribute('target')).toBe('_blank');
		expect(a?.getAttribute('rel')).toContain('noopener');
	});

	it('never creates elements from raw html or unsafe links', () => {
		const { container } = render(
			<MarkdownText text={'<img src=x onerror=alert(1)> <script>x()</script> [x](javascript:alert(1))'} />,
		);
		expect(container.querySelector('img,script')).toBeNull();
		expect(container.querySelector('a')).toBeNull();
		expect(container.textContent).toContain('<script>x()</script>');
	});

	it('renders release notes as headings, lists and commit links', () => {
		const md = '## [1.0.0](https://github.com/o/r/compare/a...b) (2026-01-01)\n\n### Features\n\n* **web:** thing ([abc](https://github.com/o/r/commit/abc))';
		const { container } = render(<MarkdownText mode="document" text={md} />);
		expect(container.querySelector('h2')).not.toBeNull();
		expect(container.querySelector('h3')?.textContent).toBe('Features');
		expect(container.querySelectorAll('li')).toHaveLength(1);
		expect(container.querySelectorAll('a')).toHaveLength(2);
		expect(container.textContent).not.toContain('**');
	});

	it('copies a fenced code block with its copy button', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		render(<MarkdownText text={'```js\nlet a = 1;\n```'} />);
		fireEvent.click(screen.getByRole('button'));
		await waitFor(() => expect(writeText).toHaveBeenCalledWith('let a = 1;'));
	});
});
