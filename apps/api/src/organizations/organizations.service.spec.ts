import { OrganizationsService } from './organizations.service';

const query = jest.fn();
const release = jest.fn();
const connect = jest.fn();
const end = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, connect, end })),
}));

const identity = {
  subject: 'keycloak-user-1',
  email: 'user@example.com',
  roles: [],
};

describe('OrganizationsService', () => {
  let service: OrganizationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    connect.mockResolvedValue({ query, release });
    service = new OrganizationsService();
  });

  it('creates an active owner membership in one personal organization on first list', async () => {
    query
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ exists: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'organization-1' }] })
      .mockResolvedValueOnce({ rows: [] }) // membership
      .mockResolvedValueOnce({ rows: [] }) // COMMIT
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'organization-1',
            name: 'Personal organization',
            role: 'owner',
          },
        ],
      });

    await expect(service.list(identity)).resolves.toEqual([
      { id: 'organization-1', name: 'Personal organization', role: 'owner' },
    ]);
    expect(query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      [identity.subject],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "role, status) VALUES ($1, $2, 'owner', 'active')",
      ),
      ['organization-1', 'user-1'],
    );
    expect(release).toHaveBeenCalled();
  });

  it('does not create a personal organization when the user already has a membership', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-1' }] })
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'organization-1',
            name: 'Existing organization',
            role: 'viewer',
          },
        ],
      });

    await expect(service.list(identity)).resolves.toEqual([
      { id: 'organization-1', name: 'Existing organization', role: 'viewer' },
    ]);
    expect(query).not.toHaveBeenCalledWith(
      'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
      ['Personal organization'],
    );
  });
});
