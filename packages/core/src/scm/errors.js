// Errors shared by every SCM provider. Messages never contain the token.

export class ScmError extends Error {
  constructor(provider, method, path, status, data) {
    const detail = typeof data === 'object' && data ? data.message ?? data.error ?? '' : '';
    const label = provider === 'github' ? 'GitHub' : provider === 'gitlab' ? 'GitLab' : provider;
    super(`${label} ${method} ${path} -> ${status}${detail ? `: ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
    this.name = 'ScmError';
    this.provider = provider;
    this.status = status;
    this.data = data;
    this.isScmError = true;
  }
}

export class GitlabError extends ScmError {
  constructor(method, path, status, data) {
    super('gitlab', method, path, status, data);
    this.name = 'GitlabError';
  }
}

export class GithubError extends ScmError {
  constructor(method, path, status, data) {
    super('github', method, path, status, data);
    this.name = 'GithubError';
  }
}

export class NotSupportedError extends Error {
  constructor(provider, op) {
    super(`${provider}: ${op} is not supported by this SCM provider`);
    this.name = 'NotSupportedError';
    this.provider = provider;
    this.op = op;
  }
}
