import React, { useEffect, useState, useRef } from 'react';
import {
  fetchRepositories,
  fetchPullRequests,
  fetchCommits,
  fetchBranches,
  fetchPullRequestThreads,
  createPullRequestThread,
} from '../../api';
import type {
  GitRepo,
  GitPullRequest,
  GitCommit,
  GitRef,
  PullRequestThread,
  GitItem,
} from '../../api';
import { Spinner } from '../shared/Spinner';
import { EmptyState } from '../shared/EmptyState';
import { PrList } from './PrList';
import { BranchList } from './BranchList';
import { FileTreeBrowser } from './FileTreeBrowser';
import { uiBridge } from '../../tools/uiBridge';
import styles from './Git.module.scss';

type GitTab = 'files' | 'prs' | 'branches';

interface GitPageProps {
  collectionUrl: string;
  project: string;
  pat: string;
}

export function GitPage({ collectionUrl, project, pat }: GitPageProps) {
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [selectedRepoId, setSelectedRepoId] = useState<string | null>(null);
  const [tab, setTab] = useState<GitTab>('files');

  // Tree state — lifted from BranchList
  const [treeBranch, setTreeBranch] = useState('');
  const [dirCache, setDirCache] = useState<Record<string, GitItem[] | null>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());

  const [prs, setPrs] = useState<GitPullRequest[]>([]);
  const [prsLoading, setPrsLoading] = useState(false);
  const [prStatus, setPrStatus] = useState<string>('active');

  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [commitsLoading, setCommitsLoading] = useState(false);

  const [branches, setBranches] = useState<GitRef[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);

  const [expandedPrId, setExpandedPrId] = useState<number | null>(null);
  const [threadsMap, setThreadsMap] = useState<Record<number, PullRequestThread[]>>({});
  const [threadsLoading, setThreadsLoading] = useState(false);
  const [newThreadText, setNewThreadText] = useState('');
  const [postingThread, setPostingThread] = useState(false);

  // ── Bridge registration ───────────────────────────────────────────────────
  const stateRef = useRef({
    repos, reposLoading, selectedRepoId, tab,
    treeBranch, prs, prsLoading, prStatus,
    commits, commitsLoading, branches, branchesLoading,
    expandedPrId, threadsMap, threadsLoading, newThreadText, postingThread,
  });
  stateRef.current = {
    repos, reposLoading, selectedRepoId, tab,
    treeBranch, prs, prsLoading, prStatus,
    commits, commitsLoading, branches, branchesLoading,
    expandedPrId, threadsMap, threadsLoading, newThreadText, postingThread,
  };

  useEffect(() => {
    uiBridge.register('git.getState', () => stateRef.current);
    uiBridge.register('git.selectRepo', (id: string) => {
      const r = stateRef.current.repos.find((x) => x.id === id || x.name === id);
      setSelectedRepoId(r?.id ?? id);
    });
    uiBridge.register('git.setBranch', (branch: string) => {
      setTreeBranch(branch);
      setDirCache({});
      setExpandedDirs(new Set());
    });
    uiBridge.register('git.switchTab', (t: 'files' | 'prs' | 'branches') => setTab(t));
    uiBridge.register('git.setPrFilter', (status: string) => setPrStatus(status));
    uiBridge.register('git.expandPr', (prId: number) =>
      setExpandedPrId((prev) => (prev === prId ? null : prId)),
    );
    uiBridge.register('git.setThreadText', setNewThreadText);
    uiBridge.register('git.postThread', () => handlePostThread());
    return () => {
      [
        'git.getState', 'git.selectRepo', 'git.setBranch', 'git.switchTab',
        'git.setPrFilter', 'git.expandPr', 'git.setThreadText', 'git.postThread',
      ].forEach((k) => uiBridge.unregister(k));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load repos on connect
  useEffect(() => {
    setReposLoading(true);
    fetchRepositories(collectionUrl, project, pat)
      .then((r) => { setRepos(r); if (r.length > 0) setSelectedRepoId(r[0].id); })
      .catch(console.error)
      .finally(() => setReposLoading(false));
  }, [collectionUrl, project, pat]);

  // Reset tree + branches when repo changes
  useEffect(() => {
    setDirCache({});
    setExpandedDirs(new Set());
    setTreeBranch('');
    setBranches([]);
  }, [selectedRepoId]);

  // Load branches whenever repo is selected
  useEffect(() => {
    if (!selectedRepoId) return;
    setBranchesLoading(true);
    fetchBranches(collectionUrl, project, pat, selectedRepoId)
      .then((b) => {
        setBranches(b);
        if (b.length > 0) {
          // prefer refs/heads/main or refs/heads/master, else first
          const found =
            b.find((br) => br.name === 'refs/heads/main' || br.name === 'refs/heads/master') ??
            b[0];
          setTreeBranch(found.name.replace('refs/heads/', ''));
        }
      })
      .catch(console.error)
      .finally(() => setBranchesLoading(false));
  }, [collectionUrl, project, pat, selectedRepoId]);

  // Load PRs when tab is prs
  useEffect(() => {
    if (!selectedRepoId || tab !== 'prs') return;
    setPrsLoading(true); setPrs([]);
    fetchPullRequests(collectionUrl, project, pat, selectedRepoId, prStatus, 50)
      .then(setPrs).catch(console.error).finally(() => setPrsLoading(false));
  }, [collectionUrl, project, pat, selectedRepoId, tab, prStatus]);

  // Load commits for current branch
  useEffect(() => {
    if (!selectedRepoId) return;
    setCommitsLoading(true); setCommits([]);
    fetchCommits(collectionUrl, project, pat, selectedRepoId, {
      top: 50,
      ...(treeBranch ? { branch: treeBranch } : {}),
    })
      .then(setCommits).catch(console.error).finally(() => setCommitsLoading(false));
  }, [collectionUrl, project, pat, selectedRepoId, treeBranch]);

  // Load PR threads when a PR is expanded
  useEffect(() => {
    if (expandedPrId == null || !selectedRepoId) return;
    if (threadsMap[expandedPrId] !== undefined) return;
    setThreadsLoading(true);
    fetchPullRequestThreads(collectionUrl, project, pat, selectedRepoId, expandedPrId)
      .then((threads) => setThreadsMap((prev) => ({ ...prev, [expandedPrId]: threads })))
      .catch(console.error)
      .finally(() => setThreadsLoading(false));
  }, [collectionUrl, project, pat, selectedRepoId, expandedPrId, threadsMap]);

  async function handlePostThread() {
    if (!newThreadText.trim() || !selectedRepoId || expandedPrId == null) return;
    setPostingThread(true);
    try {
      await createPullRequestThread(
        collectionUrl, project, pat, selectedRepoId, expandedPrId, newThreadText.trim(),
      );
      const updated = await fetchPullRequestThreads(
        collectionUrl, project, pat, selectedRepoId, expandedPrId,
      );
      setThreadsMap((prev) => ({ ...prev, [expandedPrId]: updated }));
      setNewThreadText('');
    } catch (e) {
      alert('发送失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setPostingThread(false);
    }
  }

  // Called from BranchList: switch to file view on selected branch
  function handleSelectBranch(name: string) {
    setTreeBranch(name);
    setDirCache({});
    setExpandedDirs(new Set());
    setTab('files');
  }

  const selectedRepo = repos.find((r) => r.id === selectedRepoId);
  const branchNames = branches.map((b) => b.name.replace('refs/heads/', ''));

  if (reposLoading) return <div className={styles.page}><Spinner label="加载仓库..." /></div>;
  if (repos.length === 0) return <div className={styles.page}><EmptyState icon="⑂" title="暂无 Git 仓库" /></div>;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.repoSelector}>
          <label className={styles.toolbarLabel}>仓库</label>
          <select
            className={styles.select}
            value={selectedRepoId ?? ''}
            onChange={(e) => setSelectedRepoId(e.target.value)}
          >
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {selectedRepo?.defaultBranch && (
            <span className={styles.defaultBranch}>
              默认: {selectedRepo.defaultBranch.replace('refs/heads/', '')}
            </span>
          )}
        </div>

        <div className={styles.branchSelectorWrap}>
          <label className={styles.toolbarLabel}>分支</label>
          <input
            type="text"
            list="git-branch-datalist"
            className={styles.branchSearch}
            placeholder="搜索分支..."
            value={treeBranch}
            onChange={(e) => setTreeBranch(e.target.value)}
          />
          <datalist id="git-branch-datalist">
            {branchNames.map((n) => <option key={n} value={n} />)}
          </datalist>
        </div>

        <div className={styles.tabs}>
          {(['files', 'prs', 'branches'] as GitTab[]).map((t) => (
            <button
              key={t}
              className={`${styles.tab} ${tab === t ? styles.tabActive : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'files' ? '文件' : t === 'prs' ? '拉取请求' : '分支'}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.content}>
        {tab === 'files' && (
          <FileTreeBrowser
            collectionUrl={collectionUrl}
            project={project}
            pat={pat}
            repoId={selectedRepoId}
            treeBranch={treeBranch}
            dirCache={dirCache}
            setDirCache={setDirCache}
            expandedDirs={expandedDirs}
            setExpandedDirs={setExpandedDirs}
            commits={commits}
            commitsLoading={commitsLoading}
          />
        )}
        {tab === 'prs' && (
          <PrList
            prs={prs}
            loading={prsLoading}
            prStatus={prStatus}
            onStatusChange={setPrStatus}
            expandedPrId={expandedPrId}
            onToggleExpand={(id) => setExpandedPrId((prev) => (prev === id ? null : id))}
            threadsMap={threadsMap}
            threadsLoading={threadsLoading}
            newThreadText={newThreadText}
            onThreadTextChange={setNewThreadText}
            onPostThread={handlePostThread}
            postingThread={postingThread}
          />
        )}
        {tab === 'branches' && (
          <BranchList
            branches={branches}
            loading={branchesLoading}
            selectedRepo={selectedRepo}
            onSelectBranch={handleSelectBranch}
          />
        )}
      </div>
    </div>
  );
}