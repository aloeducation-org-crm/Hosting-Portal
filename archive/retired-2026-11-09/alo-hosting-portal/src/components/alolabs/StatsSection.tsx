'use client'

import { Users, Globe, Shield, Server } from 'lucide-react'

const stats = [
  {
    value: '99.9%',
    label: 'Uptime guarantee',
    icon: <Shield className="w-6 h-6" />,
  },
  {
    value: '30+',
    label: 'Global server locations',
    icon: <Globe className="w-6 h-6" />,
  },
  {
    value: '24/7',
    label: 'Expert support',
    icon: <Users className="w-6 h-6" />,
  },
  {
    value: '10Gbps',
    label: 'Network backbone speed',
    icon: <Server className="w-6 h-6" />,
  },
]

export default function StatsSection() {
  return (
    <section className="bg-[#FFF7ED] py-16 sm:py-20 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-12">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center text-center"
            >
              <span className="mb-4 flex items-center justify-center w-12 h-12 rounded-full bg-white text-[#E8501A] shadow-sm">
                {stat.icon}
              </span>
              <span className="text-4xl sm:text-5xl lg:text-6xl font-bold text-[#E8501A] leading-none mb-2">
                {stat.value}
              </span>
              <span className="text-sm sm:text-base text-gray-500 font-medium">
                {stat.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
