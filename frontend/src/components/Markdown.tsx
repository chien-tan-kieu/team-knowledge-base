import { createElement, type ComponentPropsWithoutRef } from 'react'
import ReactMarkdown, { type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Link } from 'react-router-dom'

interface Props {
  content: string
  /** Adds data-source-line-* attrs used by wiki pages to scroll/highlight cited lines. */
  trackLines?: boolean
}

interface MdastNode {
  type: string
  value?: string
  children?: MdastNode[]
  [key: string]: unknown
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

function slugToTitle(slug: string) {
  return slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const WIKILINK_RE = /\[\[([a-z0-9]+(?:-[a-z0-9]+)*)\]\]/g

/** Splits a text node on [[slug]] wikilinks, replacing each match with a link to /wiki/slug. */
function splitWikilinks(text: MdastNode): MdastNode[] {
  const value = text.value ?? ''
  const parts: MdastNode[] = []
  let lastIndex = 0
  for (const match of value.matchAll(WIKILINK_RE)) {
    const [full, slug] = match
    const index = match.index
    if (index > lastIndex) {
      parts.push({ type: 'text', value: value.slice(lastIndex, index) })
    }
    parts.push({
      type: 'link',
      url: `/wiki/${slug}`,
      children: [{ type: 'text', value: slugToTitle(slug) }],
    })
    lastIndex = index + full.length
  }
  if (parts.length === 0) return [text]
  if (lastIndex < value.length) {
    parts.push({ type: 'text', value: value.slice(lastIndex) })
  }
  return parts
}

/** Remark plugin: rewrites [[slug]] backlink syntax (see SCHEMA.md) into real wiki links. */
function remarkWikilinks() {
  return function transform(tree: MdastNode) {
    function visit(node: MdastNode) {
      if (node.type === 'code' || node.type === 'inlineCode' || !Array.isArray(node.children)) return
      node.children = node.children.flatMap(child => {
        if (child.type === 'text') return splitWikilinks(child)
        visit(child)
        return [child]
      })
    }
    visit(tree)
  }
}

function AnchorLink({ href, children }: ComponentPropsWithoutRef<'a'> & ExtraProps) {
  if (href?.startsWith('/')) {
    return <Link to={href}>{children}</Link>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

const lineTrackedComponents = {
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
  a: AnchorLink,
}

const baseComponents = { a: AnchorLink }

/** Renders markdown (GFM + [[wikilink]] backlinks) as React elements. */
export function Markdown({ content, trackLines = false }: Props) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkWikilinks]}
      components={trackLines ? lineTrackedComponents : baseComponents}
    >
      {content}
    </ReactMarkdown>
  )
}
