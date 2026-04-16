import ReactMarkdown from 'react-markdown'

interface Props {
  content: string
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose prose-sm max-w-none font-sans text-near-black leading-relaxed">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
