import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TrekPagination from '@/components/ui/TrekPagination'

describe('TrekPagination', () => {
  it('renders nothing for a single page', () => {
    const { container } = render(
      <TrekPagination totalPages={1} currentPage={1} onPageChange={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the previous button on the first page', () => {
    render(<TrekPagination totalPages={5} currentPage={1} onPageChange={() => {}} />)
    expect(screen.getByLabelText('Previous page')).toBeDisabled()
    expect(screen.getByLabelText('Next page')).toBeEnabled()
  })

  it('disables the next button on the last page', () => {
    render(<TrekPagination totalPages={5} currentPage={5} onPageChange={() => {}} />)
    expect(screen.getByLabelText('Next page')).toBeDisabled()
  })

  it('marks the current page with aria-current', () => {
    render(<TrekPagination totalPages={5} currentPage={3} onPageChange={() => {}} />)
    expect(screen.getByLabelText('Go to page 3')).toHaveAttribute('aria-current', 'page')
  })

  it('collapses long ranges with an ellipsis', () => {
    render(<TrekPagination totalPages={20} currentPage={10} onPageChange={() => {}} />)
    expect(screen.getAllByText('…').length).toBeGreaterThan(0)
    // First and last page are always shown.
    expect(screen.getByLabelText('Go to page 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Go to page 20')).toBeInTheDocument()
  })

  it('calls onPageChange with the chosen page', async () => {
    const onPageChange = vi.fn()
    render(<TrekPagination totalPages={5} currentPage={2} onPageChange={onPageChange} />)
    await userEvent.click(screen.getByLabelText('Next page'))
    expect(onPageChange).toHaveBeenCalledWith(3)
    await userEvent.click(screen.getByLabelText('Go to page 1'))
    expect(onPageChange).toHaveBeenCalledWith(1)
  })
})
