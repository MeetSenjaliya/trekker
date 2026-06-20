import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ConfirmationModal from '@/components/ui/ConfirmationModal'

function setup(props: Partial<React.ComponentProps<typeof ConfirmationModal>> = {}) {
  const onClose = vi.fn()
  const onConfirm = vi.fn()
  const { container } = render(
    <ConfirmationModal
      isOpen
      onClose={onClose}
      onConfirm={onConfirm}
      trekTitle="Triund Trek"
      {...props}
    />
  )
  // The date input has no associated <label>, so query it by type.
  const dateInput = container.querySelector('input[type="date"]') as HTMLInputElement
  return { onClose, onConfirm, dateInput }
}

describe('ConfirmationModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <ConfirmationModal isOpen={false} onClose={() => {}} onConfirm={() => {}} />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the trek title', () => {
    setup()
    expect(screen.getByText(/Join Triund Trek/)).toBeInTheDocument()
  })

  it('keeps Confirm disabled until date + both checkboxes are set', async () => {
    const { dateInput } = setup()
    const confirm = screen.getByRole('button', { name: /confirm & join/i })
    expect(confirm).toBeDisabled()

    fireEvent.change(dateInput, { target: { value: '2099-01-01' } })
    expect(confirm).toBeDisabled()

    await userEvent.click(screen.getByLabelText(/safety instructions/i))
    await userEvent.click(screen.getByLabelText(/organizer.+rules/i))
    expect(confirm).toBeEnabled()
  })

  it('confirms with the selected date and closes', async () => {
    const { onConfirm, onClose, dateInput } = setup()
    fireEvent.change(dateInput, { target: { value: '2099-01-01' } })
    await userEvent.click(screen.getByLabelText(/safety instructions/i))
    await userEvent.click(screen.getByLabelText(/organizer.+rules/i))
    await userEvent.click(screen.getByRole('button', { name: /confirm & join/i }))

    expect(onConfirm).toHaveBeenCalledWith('2099-01-01')
    expect(onClose).toHaveBeenCalled()
  })

  it('cancels without confirming', async () => {
    const { onConfirm, onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClose).toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
  })
})
