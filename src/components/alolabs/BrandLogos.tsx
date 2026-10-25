'use client'

const technologies = [
  'Next.js',
  'React',
  'TypeScript',
  'Node.js',
  'PostgreSQL',
  'Docker',
]

export default function BrandLogos() {
  return (
    <section className="w-full bg-[#FFF7ED] py-10 md:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <p className="mb-8 text-center text-sm font-medium uppercase tracking-wider text-[#475569]">
          Powered by industry-leading technology
        </p>
        <div className="flex flex-wrap items-center justify-center gap-8 sm:gap-12 md:gap-16">
          {technologies.map((tech) => (
            <span
              key={tech}
              role="img"
              aria-label={tech}
              className="text-xl select-none sm:text-2xl md:text-3xl font-bold text-[#9CA3AF] opacity-60 transition-opacity duration-200 hover:opacity-100"
            >
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  )
}
