import { formatUsd, TLD_PRICES } from "@/lib/marketing/hosting-catalog";

export default function TldPricingTable({ limit }: { limit?: number }) {
  const rows = limit ? TLD_PRICES.slice(0, limit) : TLD_PRICES;

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <caption className="sr-only">Domain price list by extension, USD per year</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <th scope="col" className="px-4 py-3 font-semibold">
                Extension
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Register
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Renewal
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Transfer
              </th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => (
              <tr key={row.tld} className="transition-colors hover:bg-[#FFF7ED]">
                <th scope="row" className="whitespace-nowrap px-4 py-3 font-semibold text-[#1E293B]">
                  {row.tld}
                  {row.popular && (
                    <span className="ml-2 rounded-full bg-[#E8501A]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[#E8501A]">
                      Popular
                    </span>
                  )}
                </th>
                <td className="whitespace-nowrap px-4 py-3 font-bold text-[#1E293B]">
                  {formatUsd(row.register)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-[#475569]">{formatUsd(row.renewal)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-[#475569]">{formatUsd(row.transfer)}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <a
                    href="/domains#domain-search"
                    className="text-xs font-semibold text-[#E8501A] hover:underline"
                  >
                    Check a name
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-[11px] text-[#475569]">
        USD per year, excluding applicable taxes. Registry prices change; the price shown at checkout is
        final.
      </p>
    </div>
  );
}
