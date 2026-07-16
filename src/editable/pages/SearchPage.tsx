import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, Filter, Search } from 'lucide-react'
import { buildPageMetadata } from '@/lib/seo'
import { fetchSiteFeed } from '@/lib/site-connector'
import { getPostTaskKey } from '@/lib/task-data'
import { getMockPostsForTask } from '@/lib/mock-posts'
import { SITE_CONFIG, type TaskKey } from '@/lib/site-config'
import type { SitePost } from '@/lib/site-connector'
import { EditableSiteShell } from '@/editable/shell/EditableSiteShell'
import { toPlainText } from '@/editable/cards/PostCards'
import { pagesContent } from '@/editable/content/pages.content'

export const revalidate = 3

export async function generateMetadata(): Promise<Metadata> {
  return buildPageMetadata({
    path: '/search',
    title: pagesContent.search.metadata.title,
    description: pagesContent.search.metadata.description,
  })
}

const stripHtml = (value: string) => value.replace(/<[^>]*>/g, ' ')
const compactText = (value: unknown) => typeof value === 'string' ? stripHtml(value).replace(/\s+/g, ' ').trim().toLowerCase() : ''
const getContent = (post: SitePost) => post.content && typeof post.content === 'object' ? post.content as Record<string, unknown> : {}
const getImage = (post: SitePost) => {
  const content = getContent(post)
  const media = Array.isArray(post.media) ? post.media.find((item) => typeof item?.url === 'string')?.url : ''
  const images = Array.isArray(content.images) ? content.images.find((item) => typeof item === 'string') as string | undefined : ''
  return media || compactRaw(content.featuredImage) || compactRaw(content.image) || compactRaw(content.thumbnail) || images || ''
}
const compactRaw = (value: unknown) => typeof value === 'string' ? value.trim() : ''
const summaryOf = (post: SitePost) => {
  const content = getContent(post)
  // compactRaw only trims — it does NOT strip HTML — so the raw payload could leak markup
  // into the card summary. Route every candidate through toPlainText so cards stay plain,
  // and fall back to the article body when there's no dedicated summary/description.
  return toPlainText(
    (typeof post.summary === 'string' && post.summary) ||
    compactRaw(content.description) ||
    compactRaw(content.excerpt) ||
    compactRaw(content.body) ||
    '',
  )
}

const matches = (post: SitePost, query: string, category: string, task: string) => {
  const content = getContent(post)
  const typeText = compactText(content.type)
  if (typeText === 'comment') return false
  const derivedTask = getPostTaskKey(post) || typeText
  if (task && derivedTask !== task) return false
  const categoryText = compactText(content.category)
  const tagsText = compactText(Array.isArray(post.tags) ? post.tags.join(' ') : '')
  if (category && !(categoryText || tagsText).includes(category)) return false
  if (!query) return true
  return [post.title, post.summary, content.description, content.body, content.excerpt, content.category, Array.isArray(post.tags) ? post.tags.join(' ') : '']
    .some((value) => compactText(value).includes(query))
}

function SearchResultCard({ post, index }: { post: SitePost; index: number }) {
  const task = getPostTaskKey(post) as TaskKey | null
  // Route from the task config (e.g. /listing/<slug>); buildPostUrl can fall
  // back to /posts for tasks missing from the enabled taskViews map, which 404s.
  const taskRoute = SITE_CONFIG.tasks.find((item) => item.key === task)?.route
  const href = `${taskRoute || `/${task || 'article'}`}/${post.slug}`
  const image = getImage(post)
  const summary = summaryOf(post)
  const taskLabel = SITE_CONFIG.tasks.find((item) => item.key === task)?.label || 'Post'
  const strong = index % 5 === 0

  return (
    <Link href={href} className={`group block overflow-hidden border border-[var(--editable-border)] bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:border-[var(--slot4-accent)] hover:shadow-[0_16px_40px_rgba(41,48,31,.14)] ${strong ? 'md:col-span-2' : ''}`}>
      {image ? (
        <div className={`relative overflow-hidden bg-black ${strong ? 'aspect-[16/7]' : 'aspect-[16/10]'}`}>
          <img src={image} alt="" className="h-full w-full object-cover opacity-90 transition duration-500 group-hover:scale-105" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />
          <span className="absolute left-4 top-4 bg-[var(--slot4-accent)] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white">{taskLabel}</span>
        </div>
      ) : null}
      <div className="p-5 sm:p-6">
        {!image ? <span className="bg-[var(--slot4-accent)] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-white">{taskLabel}</span> : null}
        <h2 className="mt-4 line-clamp-3 text-2xl font-black leading-[0.95] tracking-[-0.06em] text-[var(--editable-page-text,#211713)]">{post.title}</h2>
        {summary ? <p className="mt-4 line-clamp-3 text-sm font-semibold leading-7 text-[var(--editable-page-text,#211713)]/65">{summary}</p> : null}
        <span className="mt-5 inline-flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] opacity-60 group-hover:opacity-100">Open result <ArrowRight className="h-4 w-4" /></span>
      </div>
    </Link>
  )
}

export default async function SearchPage({ searchParams }: { searchParams?: Promise<{ q?: string; category?: string; task?: string; master?: string }> }) {
  const resolved = (await searchParams) || {}
  const query = (resolved.q || '').trim()
  const normalized = query.toLowerCase()
  const category = (resolved.category || '').trim().toLowerCase()
  const requestedTask = (resolved.task || '').trim().toLowerCase()
  const task = requestedTask === 'listing' ? '' : requestedTask
  const useMaster = resolved.master !== '0'
  const feed = await fetchSiteFeed(useMaster ? 1000 : 300, useMaster ? { fresh: true, category: category || undefined, task: task || undefined } : undefined)
  const posts = feed?.posts?.length ? feed.posts : useMaster ? [] : SITE_CONFIG.tasks.filter((item) => item.enabled).flatMap((item) => getMockPostsForTask(item.key))
  const results = posts.filter((post) => getPostTaskKey(post) !== 'listing' && matches(post, normalized, category, task)).slice(0, normalized ? 80 : 36)
  const enabledTasks = SITE_CONFIG.tasks.filter((item) => item.enabled && item.key !== 'listing')

  return (
    <EditableSiteShell>
      <main className="min-h-screen bg-[var(--editable-page-bg,#fff7ee)] text-[var(--editable-page-text,#2f1d16)]">
        <section className="mx-auto max-w-[var(--editable-container)] px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
          <div className="grid overflow-hidden border border-[var(--editable-border)] bg-white shadow-[0_24px_70px_rgba(41,48,31,0.10)] md:grid-cols-[0.9fr_1.1fr]">
            <div className="relative overflow-hidden bg-[#343a27] p-7 text-white sm:p-10 lg:p-12">
              <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full border-[42px] border-[#84934A]/40" />
              <div className="relative border-l-4 border-[#84934A] pl-6">
              <p className="text-xs font-black uppercase tracking-[0.28em] text-white/60">{pagesContent.search.hero.badge}</p>
              <h1 className="mt-5 text-4xl font-black leading-[0.95] tracking-[-0.06em] sm:text-5xl">Find your next useful read.</h1>
              <p className="mt-5 max-w-xl text-sm font-semibold leading-7 text-white/70">Search Centipy articles by keyword or category and move straight to the stories that matter to you.</p>
              </div>
            </div>
            <form action="/search" className="self-center bg-[var(--slot4-warm)] p-6 sm:p-9 lg:p-12">
              <p className="mb-4 text-xs font-black uppercase tracking-[.24em] text-[var(--slot4-accent)]">Search the archive</p>
              <input type="hidden" name="master" value="1" />
              <label className="flex items-center gap-3 border border-[var(--editable-border)] bg-white px-4 py-3">
                <Search className="h-5 w-5 opacity-45" />
                <input name="q" defaultValue={query} placeholder={pagesContent.search.hero.placeholder} className="min-w-0 flex-1 bg-transparent text-base font-bold outline-none placeholder:text-current/35" />
              </label>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="flex items-center gap-2 border border-[var(--editable-border)] bg-white px-4 py-3">
                  <Filter className="h-4 w-4 opacity-45" />
                  <input name="category" defaultValue={category} placeholder="Category" className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-current/35" />
                </label>
                <select name="task" defaultValue={task} className="border border-[var(--editable-border)] bg-white px-4 py-3 text-sm font-black outline-none">
                  <option value="">All content types</option>
                  {enabledTasks.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
                </select>
              </div>
              <button className="mt-3 inline-flex h-12 w-full items-center justify-center bg-[var(--slot4-accent)] px-6 text-sm font-black uppercase tracking-[0.18em] text-white transition hover:brightness-95" type="submit">Search</button>
            </form>
          </div>

          <div className="mt-10 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.24em] opacity-50">{results.length} results</p>
              <h2 className="mt-2 text-3xl font-black tracking-[-0.06em]">{query ? `Results for “${query}”` : pagesContent.search.resultsTitle}</h2>
            </div>
            <Link href="/article" className="inline-flex items-center gap-2 border border-[var(--slot4-accent)] bg-white px-5 py-3 text-sm font-black text-[var(--slot4-accent)] transition hover:bg-[var(--slot4-accent)] hover:text-white">Browse latest <ArrowRight className="h-4 w-4" /></Link>
          </div>

          {results.length ? (
            <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {results.map((post, index) => <SearchResultCard key={post.id || post.slug} post={post} index={index} />)}
            </div>
          ) : (
            <div className="mt-8 border border-dashed border-[var(--editable-border)] bg-white/70 p-10 text-center">
              <p className="text-2xl font-black tracking-[-0.04em]">No matching posts found.</p>
              <p className="mt-3 text-sm font-semibold opacity-60">Try a different keyword, task type, or category.</p>
            </div>
          )}
        </section>
      </main>
    </EditableSiteShell>
  )
}
