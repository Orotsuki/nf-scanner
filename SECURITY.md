# Security

NF Scanner uses layered controls for authentication, authorization, secrets and abuse prevention.

## Secrets

- Never commit Supabase Secret/Service Role keys.
- Never commit Cloudflare Turnstile secret keys.
- Browser configuration may contain only public values such as the Supabase Publishable Key and Turnstile Site Key.
- Local environment files are excluded by `.gitignore`.

## Database

- Row Level Security (RLS) is enabled on application tables.
- Application data is scoped to the authenticated user's `auth.uid()`.
- Anonymous database access is revoked.
- The authenticated role receives only SELECT, INSERT, UPDATE and DELETE on application tables.

## Authentication

- Supabase Auth handles password verification and sessions.
- Cloudflare Turnstile can be enforced on login through Supabase Auth CAPTCHA protection.
- Administrative operations require an authenticated user with the `admin` role.

## Deployment

- Source code should remain in a private GitHub repository.
- Production static hosting should use Cloudflare Pages.
- Cloudflare security headers are defined in `public/_headers`.

## Incident response

If a secret is ever committed to the repository, treat it as compromised: rotate/revoke the credential first, then remove it from the repository history.
