import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChatMarkdown } from './chat-markdown.js';

describe('assistant markdown', () => {
  it('renders safe GFM structures and strips executable raw HTML', () => {
    const html = renderToStaticMarkup(createElement(ChatMarkdown, { body: '# Heading\n\n**Bold** and `code`.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n[Safe](https://example.com)' }));
    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<strong>Bold</strong>');
    expect(html).toContain('<table>');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(renderToStaticMarkup(createElement(ChatMarkdown, { body: '[Bad](javascript:alert(1))' }))).not.toContain('javascript:');
  });
  it('keeps incomplete streaming markup readable', () => {
    expect(renderToStaticMarkup(createElement(ChatMarkdown, { body: 'Working **through this' }))).toContain('Working **through this');
  });
});
