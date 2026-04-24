import { createElement, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li' | 'pre' | 'blockquote' | 'table'

function withLines<T extends Tag>(tag: T) {
  return function Component(props: ComponentPropsWithoutRef<T> & ExtraProps) {
    const { node, ...rest } = props
    return createElement(tag, {
      ...rest,
      'data-source-line-start': node?.position?.start?.line,
      'data-source-line-end': node?.position?.end?.line,
    })
  }
}

const components = {
  p: withLines('p'),
  h1: withLines('h1'),
  h2: withLines('h2'),
  h3: withLines('h3'),
  h4: withLines('h4'),
  h5: withLines('h5'),
  h6: withLines('h6'),
  ul: withLines('ul'),
  ol: withLines('ol'),
  li: withLines('li'),
  pre: withLines('pre'),
  blockquote: withLines('blockquote'),
  table: withLines('table'),
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose-wiki">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{content}</ReactMarkdown>
    </div>
  )
}
