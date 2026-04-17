import ReactMarkdown from 'react-markdown'

interface Props {
  content: string
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose md:prose-sm max-w-none font-sans text-near-black leading-relaxed prose-pre:overflow-x-auto prose-pre:whitespace-pre prose-code:break-words">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  )
}
