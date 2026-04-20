import ReactMarkdown from 'react-markdown'

interface Props {
  content: string
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose-wiki">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
