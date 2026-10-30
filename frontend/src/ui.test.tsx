import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { Form, toPayload, Pager, DataTable } from './ui';
import LoginPage from './pages/LoginPage';

vi.mock('./api', async (orig) => ({ ...(await orig<any>()), api: vi.fn() }));
import { api, setToken } from './api';
import { AuthProvider, ProtectedRoute as Guarded } from './auth';
const apiMock = api as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => { apiMock.mockReset(); setToken(null); });

describe('toPayload', () => {
  it('converts numbers, drops blanks, keeps checkbox booleans', () => {
    const fields: any[] = [
      { name: 'price', label: 'p', type: 'number' }, { name: 'note', label: 'n' }, { name: 'cat', label: 'c', type: 'select', numeric: true }, { name: 'on', label: 'o', type: 'checkbox' },
    ];
    expect(toPayload(fields, { price: '9.5', note: '', cat: '3', on: undefined })).toEqual({ price: 9.5, cat: 3, on: false });
  });
});

describe('Form', () => {
  it('submits converted values and shows API errors', async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Invalid request'), { details: [{ path: 'sku', message: 'bad sku' }] }));
    render(<Form fields={[{ name: 'sku', label: 'SKU', required: true }, { name: 'qty', label: 'Qty', type: 'number' }]} onSubmit={onSubmit} />);
    await userEvent.type(screen.getByLabelText(/SKU/), 'ABC-1');
    await userEvent.type(screen.getByLabelText(/Qty/), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ sku: 'ABC-1', qty: 4 }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid request');
    expect(screen.getByRole('alert')).toHaveTextContent('sku: bad sku');
  });
});

describe('DataTable / Pager', () => {
  it('renders rows, empty state and paging state', async () => {
    const { rerender } = render(<DataTable rowKey={(r: any) => r.id} rows={[]} columns={[{ header: 'A', cell: (r: any) => r.a }]} empty="Nothing here" />);
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    rerender(<DataTable rowKey={(r: any) => r.id} rows={[{ id: 1, a: 'x' }]} columns={[{ header: 'A', cell: (r: any) => r.a }]} />);
    expect(screen.getByText('x')).toBeInTheDocument();
    const onPage = vi.fn();
    render(<Pager page={1} pageSize={10} total={25} onPage={onPage} />);
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });
});

describe('ProtectedRoute', () => {
  const tree = (perm?: string) => (
    <AuthProvider>
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route path="/secret" element={<Guarded perm={perm}><p>secret content</p></Guarded>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>
  );
  it('redirects anonymous users to login', async () => {
    render(tree());
    expect(await screen.findByText('login page')).toBeInTheDocument();
  });
  it('blocks users lacking the permission', async () => {
    setToken('t');
    apiMock.mockResolvedValue({ user: { id: 1, permissions: ['products.read'], role: 'Viewer' } });
    render(tree('users.read'));
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });
  it('allows users who have the permission', async () => {
    setToken('t');
    apiMock.mockResolvedValue({ user: { id: 1, permissions: ['users.read'], role: 'Admin' } });
    render(tree('users.read'));
    expect(await screen.findByText('secret content')).toBeInTheDocument();
  });
});

describe('LoginPage', () => {
  it('sends the entered credentials and shows failures', async () => {
    apiMock.mockRejectedValueOnce(new Error('Invalid email or password'));
    render(<AuthProvider><MemoryRouter><LoginPage /></MemoryRouter></AuthProvider>);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(apiMock).toHaveBeenCalledWith('/auth/login', { method: 'POST', body: { email: 'a@b.co', password: 'pw' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });
});
