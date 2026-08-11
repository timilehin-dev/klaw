import './globals.css'

export const metadata = {
  title: 'Klaw',
  description: 'Agentic AI Platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans antialiased">{children}</body>
    </html>
  )
}
