import ReactMarkdown from 'react-markdown'

interface Props {
  content: string
}

type Tag = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'ul' | 'ol' | 'li' | 'pre' | 'blockquote' | 'table'

function withLines(tag: Tag) {
  return function Component(props: any) {
    const { node, ...rest } = props
    const Tag = tag as any
    return (
      <Tag
        data-source-line-start={node?.position?.start?.line}
        data-source-line-end={node?.position?.end?.line}
        {...rest}
      />
    )
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
    <div className="prose md:prose-sm max-w-none font-sans text-near-black leading-relaxed prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-code:break-words">
      <ReactMarkdown components={components}>{content}</ReactMarkdown>
    </div>
  )
}
