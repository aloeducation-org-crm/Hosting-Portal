'use client'

import { Star, Play } from 'lucide-react'

interface Testimonial {
  name: string
  initials: string
  color: string
  role: string
  company: string
  rating: number
  text: string
  tags: string[]
  hasVideo?: boolean
}

const testimonials: Testimonial[] = [
  {
    name: 'Jordi Robert',
    initials: 'JR',
    color: '#E8501A',
    role: 'Digital Marketing Manager',
    company: 'Nova Digital',
    rating: 5,
    text: "ALO Labs made building our agency site incredibly simple. The drag-and-drop builder is intuitive, and our site loads blazingly fast. Couldn't be happier with the results.",
    tags: ['Website Builder', 'Hosting'],
    hasVideo: true,
  },
  {
    name: 'Jarrott Brown',
    initials: 'JB',
    color: '#0891B2',
    role: 'Freelance Designer',
    company: 'Self-employed',
    rating: 5,
    text: "I've tried many hosting providers, but ALO Labs stands out for reliability. Zero downtime in 8 months and their support team is incredibly responsive whenever I need help.",
    tags: ['Hosting', 'Domains'],
  },
  {
    name: 'Anna Franques',
    initials: 'AF',
    color: '#D946EF',
    role: 'E-commerce Owner',
    company: 'Bella Botanica',
    rating: 5,
    text: 'Setting up my online store was a breeze. The integrated payment options and professional templates gave my brand an instant credibility boost from day one.',
    tags: ['Website Builder', 'E-commerce'],
    hasVideo: true,
  },
  {
    name: 'Albert Bermejo',
    initials: 'AB',
    color: '#059669',
    role: 'Startup Founder',
    company: 'TechFlow',
    rating: 5,
    text: "Migrating from our old host to ALO Labs was seamless. The performance improvement was immediate — our page speed scores jumped by 40% across the board.",
    tags: ['Hosting', 'Email'],
  },
  {
    name: 'Mitch Cardoza',
    initials: 'MC',
    color: '#EA580C',
    role: 'Content Creator',
    company: 'MitchMedia',
    rating: 5,
    text: "The email hosting is fantastic. Clean interface, great spam filtering, and I love having everything under one roof — domains, email, and my portfolio site.",
    tags: ['Email', 'Domains', 'Website Builder'],
  },
  {
    name: 'Elise Hernaez',
    initials: 'EH',
    color: '#DC2626',
    role: 'Restaurant Owner',
    company: 'Casa Elise',
    rating: 5,
    text: "I'm not tech-savvy at all, but I managed to build a beautiful website for my restaurant in just one afternoon. The templates are gorgeous and easy to customize.",
    tags: ['Website Builder'],
    hasVideo: true,
  },
]

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex gap-0.5">
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          size={16}
          className={
            i < rating
              ? 'fill-[#F59E0B] text-[#F59E0B]'
              : 'fill-gray-200 text-gray-200'
          }
        />
      ))}
    </div>
  )
}

export default function TestimonialsSection() {
  return (
    <section className="w-full bg-white py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Heading */}
        <div className="mb-10 text-center md:mb-14">
          <p className="mb-2 text-sm font-medium uppercase tracking-wider text-[#475569]">
            Trusted by
          </p>
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl md:text-4xl">
            They succeeded online &mdash; now it&rsquo;s your turn
          </h2>
        </div>

        {/* Testimonial Cards Carousel */}
        <div className="alo-testimonial-scroll -mx-4 flex gap-5 overflow-x-auto px-4 pb-4 sm:gap-6 md:-mx-6 md:px-6">
          {testimonials.map((t, idx) => (
            <div
              key={idx}
              className="flex min-w-[320px] max-w-[380px] flex-shrink-0 flex-col justify-between rounded-2xl bg-white p-6 shadow-sm ring-1 ring-[#E2E8F0] transition-shadow duration-200 hover:shadow-md"
            >
              <div>
                {/* Avatar + Info */}
                <div className="mb-4 flex items-center gap-3">
                  <div
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: t.color }}
                  >
                    {t.initials}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#1E293B]">
                      {t.name}
                    </p>
                    <p className="truncate text-xs text-[#475569]">
                      {t.role}, {t.company}
                    </p>
                  </div>
                </div>

                {/* Stars */}
                <div className="mb-3">
                  <StarRating rating={t.rating} />
                </div>

                {/* Review Text */}
                <p className="mb-4 text-sm leading-relaxed text-[#1E293B]/80">
                  &ldquo;{t.text}&rdquo;
                </p>
              </div>

              {/* Bottom Row: Tags + Video */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2E8F0] pt-4">
                <div className="flex flex-wrap gap-1.5">
                  {t.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[#FFF7ED] px-2.5 py-0.5 text-[11px] font-medium text-[#E8501A]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                {t.hasVideo && (
                  <button
                    type="button"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[#E8501A] transition-colors hover:text-[#C73D12]"
                    aria-label={`Watch video testimonial from ${t.name}`}
                  >
                    <Play size={12} className="fill-[#E8501A]" />
                    Watch video
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Trustpilot Reference */}
        <div className="mt-10 flex flex-col items-center gap-2 md:mt-14">
          <div className="flex items-center gap-1">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star
                key={i}
                size={18}
                className="fill-[#00B67A] text-[#00B67A]"
              />
            ))}
          </div>
          <p className="text-xs text-[#475569]">
            Customer reviews powered by{' '}
            <span className="font-semibold text-[#1E293B]">Trustpilot</span>
          </p>
        </div>
      </div>
    </section>
  )
}