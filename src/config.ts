export const repository = {
  owner: import.meta.env.VITE_GITHUB_OWNER?.trim() || '',
  repo: import.meta.env.VITE_GITHUB_REPO?.trim() || '',
  branch: import.meta.env.VITE_GITHUB_BRANCH?.trim() || 'main',
};

export const configured = Boolean(repository.owner && repository.repo);
export const basePath = import.meta.env.BASE_URL;
export const siteUrl = import.meta.env.VITE_PUBLIC_SITE_URL?.trim() || new URL(basePath, window.location.origin).href;
export const assetUrl = (path: string) => `${basePath}${path}`;
export const deploymentUrl = `https://github.com/${encodeURIComponent(repository.owner)}/${encodeURIComponent(repository.repo)}/actions`;
export const draftKey = `${repository.owner}/${repository.repo}/${repository.branch}/${basePath}`;
