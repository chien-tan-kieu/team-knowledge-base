import { Markdown } from './Markdown'

interface Props {
  content: string
}

export function WikiPageViewer({ content }: Props) {
  return (
    <div className="prose-wiki">
      <Markdown content={content} trackLines />
    </div>
  )
}
