import { createElement } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function ChatMarkdown({body}:{body:string}) {
  return createElement('div', { className: 'chat-markdown' }, createElement(Markdown, {
    remarkPlugins: [remarkGfm],
    skipHtml: true,
    components: { a: ({href, children, ...props}) => createElement('a', { ...props, href, onClick: (event) => { event.preventDefault(); if (href) void window.waypoint.openExternal(href).catch(() => undefined); }, rel: 'noreferrer noopener' }, children) },
    children: body,
  }));
}
