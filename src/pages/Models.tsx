import { useState, useEffect } from 'react';
import { Cpu, Check, RefreshCw, Zap, Key, Search, Star, AlertCircle, ChevronDown, ChevronRight, Trash2, Plus, Timer, Play, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import './Models.css';

interface Provider {
  id: string;
  name: string;
}

interface Model {
  id: string;
  name: string;
  owned_by?: string;
}
interface BenchmarkResult {
  status: 'pending' | 'ok' | 'error';
  tps?: number;
  latencyMs?: number;
  outputTokens?: number;
  error?: string;
}

interface SavedApiKey {
  id: string;
  provider: string;
  apiKey: string;
  name: string; // 用户自定义名称或自动生成
  models: Model[];
  validated: boolean;
  createdAt: number;
}

// 类型断言
const electronAPI = window.electronAPI as any;

// 清除 ANSI 转义序列
const stripAnsi = (str: string): string => {
  // 匹配所有 ANSI 转义序列
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
            .replace(/\[\d+m/g, '')
            .replace(/\x1B\]/g, '')
            .trim();
};

// 从输出中提取实际模型名
const extractModelName = (output: string): string => {
  const cleaned = stripAnsi(output);
  // 尝试匹配常见的模型格式
  const patterns = [
    /model[:\s]+([\w\-\/\.]+)/i,
    /(nvidia\/[\w\-\/\.]+)/i,
    /(openai\/[\w\-\/\.]+)/i,
    /(anthropic\/[\w\-\/\.]+)/i,
    /(deepseek[\w\-\/\.]*)/i,
  ];
  
  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (match) return match[1];
  }
  
  // 如果没有匹配，返回第一行有效内容
  const lines = cleaned.split('\n').filter(l => l.trim() && !l.includes('Doctor') && !l.includes('Config'));
  return lines[0] || '未配置';
};

// 生成 API Key 显示名称
const generateKeyName = (apiKey: string, provider: string): string => {
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);
  return `${provider} (${prefix}...${suffix})`;
};

// 测速状态缓存
const BENCHMARK_STATE_KEY = 'Drivemolt_benchmark_state';

function loadBenchmarkState() {
  try {
    const saved = localStorage.getItem(BENCHMARK_STATE_KEY);
    if (saved) {
      const state = JSON.parse(saved);
      // 检查是否过期（5分钟）
      if (state.timestamp && Date.now() - state.timestamp < 5 * 60 * 1000) {
        return state;
      }
    }
  } catch {}
  return null;
}

function saveBenchmarkState(benchmarking: boolean, progress: { done: number; total: number } | null) {
  try {
    if (benchmarking && progress) {
      localStorage.setItem(BENCHMARK_STATE_KEY, JSON.stringify({
        benchmarking,
        progress,
        timestamp: Date.now()
      }));
    } else {
      localStorage.removeItem(BENCHMARK_STATE_KEY);
    }
  } catch {}
}

export default function Models() {
  const cachedBenchmarkState = loadBenchmarkState();
  const [currentModel, setCurrentModel] = useState<string>('');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [savedKeys, setSavedKeys] = useState<SavedApiKey[]>([]);
  const [activeKeyId, setActiveKeyId] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string>('nvidia');
  const [newApiKey, setNewApiKey] = useState('');
  const [newKeyName, setNewKeyName] = useState('');
  const [loading, setLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [favorites, setFavorites] = useState<string[]>([]);
  const [expandedProviders, setExpandedProviders] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('Drivemolt_expanded_providers');
      return saved ? JSON.parse(saved) : ['nvidia'];
    } catch { return ['nvidia']; }
  });
  const [switching, setSwitching] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAddKey, setShowAddKey] = useState(false);
  // 如果缓存显示正在测速，说明上次被中断了
  const [benchmarking, setBenchmarking] = useState(false);
  const [benchmarkProgress, setBenchmarkProgress] = useState<{ done: number; total: number } | null>(cachedBenchmarkState?.progress || null);
  const [benchmarkInterrupted, setBenchmarkInterrupted] = useState(cachedBenchmarkState?.benchmarking || false);
  const [benchmarkResults, setBenchmarkResults] = useState<Record<string, BenchmarkResult>>({});
  const [sortMode, setSortMode] = useState<'none' | 'tps' | 'latency'>(() => {
    return (localStorage.getItem('Drivemolt_sort_mode') as 'none' | 'tps' | 'latency') || 'none';
  });
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(() => {
    return (localStorage.getItem('Drivemolt_sort_direction') as 'asc' | 'desc') || 'desc';
  });
  
  // 保存测速状态
  useEffect(() => {
    saveBenchmarkState(benchmarking, benchmarkProgress);
    // 测速完成后清除中断状态
    if (!benchmarking && benchmarkProgress === null) {
      setBenchmarkInterrupted(false);
    }
  }, [benchmarking, benchmarkProgress]);

  useEffect(() => {
    loadProviders();
    loadCurrentModel();
    loadSavedKeys();
    loadBenchmarkResults();
    // 缓存的测速状态会自动恢复显示
  }, []);

  // 加载测速结果
  const loadBenchmarkResults = () => {
    try {
      const saved = localStorage.getItem('Drivemolt_benchmark_results');
      if (saved) {
        const results = JSON.parse(saved) as Record<string, BenchmarkResult>;
        // 过滤掉 pending 状态的结果
        const filtered = Object.fromEntries(
          Object.entries(results).filter(([_, v]) => v.status !== 'pending')
        );
        setBenchmarkResults(filtered);
      }
    } catch (e) {
      console.error('Failed to load benchmark results', e);
    }
  };

  // 保存测速结果
  const saveBenchmarkResults = (results: Record<string, BenchmarkResult>) => {
    try {
      // 只保存有结果的（排除 pending）
      const toSave = Object.fromEntries(
        Object.entries(results).filter(([_, v]) => v.status !== 'pending')
      );
      localStorage.setItem('Drivemolt_benchmark_results', JSON.stringify(toSave));
    } catch (e) {
      console.error('Failed to save benchmark results', e);
    }
  };

  const persistKeys = (keys: SavedApiKey[]) => {
    try {
      localStorage.setItem('Drivemolt_saved_keys', JSON.stringify(keys));
      return true;
    } catch (e) {
      // 若模型列表过大导致存储失败，则仅保存 key 元信息
      try {
        const compact = keys.map(k => ({ ...k, models: [] }));
        localStorage.setItem('Drivemolt_saved_keys', JSON.stringify(compact));
        return true;
      } catch (e2) {
        console.error('Failed to persist keys', e2);
        return false;
      }
    }
  };

  const refreshModelsForKey = async (key: SavedApiKey) => {
    try {
      const result = await electronAPI?.api.listModels(key.provider, key.apiKey);
      if (result?.success && result.models) {
        setSavedKeys(prev => {
          const updated = prev.map(k => k.id === key.id ? { ...k, models: result.models } : k);
          persistKeys(updated);
          return updated;
        });
      }
    } catch (e) {
      console.error('Failed to refresh models', e);
    }
  };

  // 加载已保存的 API Keys
  const loadSavedKeys = async () => {
    try {
      const saved = localStorage.getItem('Drivemolt_saved_keys');
      if (saved) {
        const keys = JSON.parse(saved) as SavedApiKey[];
        setSavedKeys(keys);
        
        // 加载当前激活的 key
        const activeId = localStorage.getItem('Drivemolt_active_key');
        if (activeId && keys.find(k => k.id === activeId)) {
          setActiveKeyId(activeId);
        } else if (keys.length > 0) {
          setActiveKeyId(keys[0].id);
        }

        const activeKey = keys.find(k => k.id === (activeId || keys[0]?.id));
        if (activeKey && (!activeKey.models || activeKey.models.length === 0)) {
          await refreshModelsForKey(activeKey);
        }
      }
      setFavorites(JSON.parse(localStorage.getItem('Drivemolt_favorites') || '[]'));
    } catch (e) {
      console.error('Failed to load saved keys', e);
    }
  };

  const loadProviders = async () => {
    try {
      const result = await electronAPI?.api.providers();
      if (result) setProviders(result);
    } catch (e) {
      console.error('Failed to load providers', e);
    }
  };

  const loadCurrentModel = async () => {
    setLoading(true);
    try {
      // 优先从 localStorage 加载（避免闪烁）
      const cachedModel = localStorage.getItem('Drivemolt_current_model');
      if (cachedModel) {
        setCurrentModel(cachedModel);
      }
      
      // 从moltBOT完整配置读取
      const moltBOTConfig = await electronAPI?.moltBOT.getConfig();
      if (moltBOTConfig) {
        // 优先读取 agents.defaults.model.primary
        const primaryModel = moltBOTConfig.agents?.defaults?.model?.primary || 
                            moltBOTConfig.agents?.defaults?.model || 
                            moltBOTConfig.model || '';
        
        if (primaryModel && typeof primaryModel === 'string') {
          setCurrentModel(primaryModel);
          localStorage.setItem('Drivemolt_current_model', primaryModel);
        } else if (!cachedModel) {
          // 尝试从 CLI 读取
          const result = await electronAPI?.moltBOT.configGet('agents.defaults.model.primary');
          if (result) {
            const modelName = extractModelName(result);
            if (modelName && modelName !== '未配置') {
              setCurrentModel(modelName);
              localStorage.setItem('Drivemolt_current_model', modelName);
            }
          }
        }
      } else if (!cachedModel) {
        // 配置文件读取失败，尝试 CLI
        const result = await electronAPI?.moltBOT.configGet('agents.defaults.model.primary');
        if (result) {
          const modelName = extractModelName(result);
          if (modelName && modelName !== '未配置') {
            setCurrentModel(modelName);
            localStorage.setItem('Drivemolt_current_model', modelName);
          }
        }
      }
    } catch (e) {
      console.error('Failed to load model', e);
    }
    setLoading(false);
  };

  // 保存 API Keys
  const saveKeys = (keys: SavedApiKey[]) => {
    persistKeys(keys);
  };

  const syncApiKeyTomoltBOT = async (providerId: string, apiKey: string) => {
    // moltBOT 的 provider auth 读取自 models.providers.<provider>.apiKey
    // （对 nvidia 这一步是必须的；对其它 provider 也兼容）
    const configPath = `models.providers.${providerId}.apiKey`
    await electronAPI?.moltBOT.updateConfig({ [configPath]: apiKey })
  }

  // 设置激活的 API Key
  const activateKey = async (keyId: string) => {
    const key = savedKeys.find(k => k.id === keyId);
    if (!key) return;
    
    setActiveKeyId(keyId);
    localStorage.setItem('Drivemolt_active_key', keyId);
    if (!key.models || key.models.length === 0) {
      await refreshModelsForKey(key);
    }
    
    // 同步到 moltBOT 配置
    try {
      await syncApiKeyTomoltBOT(key.provider, key.apiKey)
      await electronAPI?.notify('API Key 已切换', key.name);
    } catch (e) {
      console.error('Failed to set API key', e);
    }
  };

  // 删除 API Key
  const deleteKey = (keyId: string) => {
    const updated = savedKeys.filter(k => k.id !== keyId);
    setSavedKeys(updated);
    saveKeys(updated);
    
    if (activeKeyId === keyId) {
      const newActive = updated.length > 0 ? updated[0].id : null;
      setActiveKeyId(newActive);
      if (newActive) {
        localStorage.setItem('Drivemolt_active_key', newActive);
      } else {
        localStorage.removeItem('Drivemolt_active_key');
      }
    }
  };

  const detectModels = async () => {
    if (!newApiKey.trim()) {
      setError('请输入 API Key');
      return;
    }

    // 检查是否已存在相同的 key
    if (savedKeys.some(k => k.apiKey === newApiKey.trim())) {
      setError('该 API Key 已存在');
      return;
    }

    setDetecting(true);
    setError(null);

    try {
      // 先验证 Key
      const validateResult = await electronAPI?.api.validateKey(selectedProvider, newApiKey);
      
      if (!validateResult?.valid) {
        setError(`API Key 无效 (状态码: ${validateResult?.statusCode || 'unknown'})`);
        setDetecting(false);
        return;
      }

      // 获取模型列表
      const result = await electronAPI?.api.listModels(selectedProvider, newApiKey);
      
      if (result?.success && result.models) {
        const newKey: SavedApiKey = {
          id: `key-${Date.now()}`,
          provider: selectedProvider,
          apiKey: newApiKey.trim(),
          name: newKeyName.trim() || generateKeyName(newApiKey.trim(), selectedProvider),
          models: result.models,
          validated: true,
          createdAt: Date.now()
        };
        
        const updated = [...savedKeys, newKey];
        setSavedKeys(updated);
        saveKeys(updated);
        
        // 如果是第一个 key，自动激活
        if (savedKeys.length === 0) {
          activateKey(newKey.id);
        }
        
        // 清空输入
        setNewApiKey('');
        setNewKeyName('');
        setShowAddKey(false);
        
        // 展开该提供商
        if (!expandedProviders.includes(selectedProvider)) {
          setExpandedProviders([...expandedProviders, selectedProvider]);
        }
        
        await electronAPI?.notify('API Key 添加成功', `发现 ${result.models.length} 个可用模型`);
      } else {
        setError(result?.error || '检测失败');
      }
    } catch (e: any) {
      setError(e.message || '检测失败');
    }

    setDetecting(false);
  };

  const switchModel = async (providerId: string, modelId: string, keyId?: string) => {
    const fullModelId = `${providerId}/${modelId}`;
    if (switching || fullModelId === currentModel) return;
    
    setSwitching(fullModelId);
    try {
      // 使用 updateConfig 设置正确的配置路径
      const updateResult = await electronAPI?.moltBOT.updateConfig({
        'agents.defaults.model.primary': fullModelId
      });
      
      console.log('[Models] Config update result:', updateResult, 'Model:', fullModelId);
      
      // 验证配置是否写入成功
      const verifyConfig = await electronAPI?.moltBOT.getConfig();
      const savedModel = verifyConfig?.agents?.defaults?.model?.primary;
      console.log('[Models] Verified saved model:', savedModel);
      
      if (savedModel !== fullModelId) {
        console.error('[Models] Model not saved correctly! Expected:', fullModelId, 'Got:', savedModel);
      }
      
      // 使用指定的 key 或当前激活的 key
      const targetKeyId = keyId || activeKeyId;
      const key = savedKeys.find(k => k.id === targetKeyId);
      if (key?.apiKey) {
        await syncApiKeyTomoltBOT(providerId, key.apiKey)
      }
      
      setCurrentModel(fullModelId);
      // 保存到localStorage作为备份
      localStorage.setItem('Drivemolt_current_model', fullModelId);
      
      // 检查是否自动重启 Gateway（默认开启）
      const autoRestart = localStorage.getItem('Drivemolt_auto_restart_gateway') !== 'false';
      if (autoRestart) {
        await electronAPI?.notify('模型已切换', `${fullModelId} - Gateway 将自动重启...`);
        // moltBOT 会检测到 lastTouchedAt 变化并自动重启
        // 等待几秒让 moltBOT 完成重启
        await new Promise(r => setTimeout(r, 3000));
        await electronAPI?.notify('Gateway 已重载', `当前模型: ${fullModelId}`);
      } else {
        await electronAPI?.notify('模型已切换', `${fullModelId} - 重启 Gateway 生效`);
      }
    } catch (e) {
      console.error('Failed to switch model', e);
    }
    setSwitching(null);
  };

  const toggleFavorite = (modelId: string) => {
    const newFavorites = favorites.includes(modelId)
      ? favorites.filter(f => f !== modelId)
      : [...favorites, modelId];
    setFavorites(newFavorites);
    localStorage.setItem('Drivemolt_favorites', JSON.stringify(newFavorites));
  };

  const toggleProvider = (providerId: string) => {
    setExpandedProviders(prev => {
      const updated = prev.includes(providerId) 
        ? prev.filter(p => p !== providerId)
        : [...prev, providerId];
      localStorage.setItem('Drivemolt_expanded_providers', JSON.stringify(updated));
      return updated;
    });
  };

  const filterModels = (models: Model[]) => {
    if (!searchTerm) return models;
    const term = searchTerm.toLowerCase();
    return models.filter(m => 
      m.id.toLowerCase().includes(term) || 
      m.name.toLowerCase().includes(term)
    );
  };

  // 获取当前激活 key 的模型
  const getActiveKeyModels = () => {
    const activeKey = savedKeys.find(k => k.id === activeKeyId);
    return activeKey?.models || [];
  };

  // 获取当前激活 key 的 provider
  const getActiveProvider = () => {
    const activeKey = savedKeys.find(k => k.id === activeKeyId);
    return activeKey?.provider || null;
  };

  // 测速单个模型
  const benchmarkSingleModel = async (modelId: string) => {
    const activeKey = savedKeys.find(k => k.id === activeKeyId);
    if (!activeKey) return;
    
    const provider = activeKey.provider;
    const fullId = `${provider}/${modelId}`;
    
    setBenchmarkResults(prev => ({
      ...prev,
      [fullId]: { status: 'pending' }
    }));
    
    try {
      const result = await electronAPI?.api.benchmarkModel(provider, activeKey.apiKey, modelId);
      if (result?.success) {
        setBenchmarkResults(prev => {
          const updated = {
            ...prev,
            [fullId]: {
              status: 'ok' as const,
              tps: result.tps,
              latencyMs: result.latencyMs,
              outputTokens: result.outputTokens
            }
          };
          saveBenchmarkResults(updated);
          return updated;
        });
      } else {
        setBenchmarkResults(prev => {
          const updated = {
            ...prev,
            [fullId]: { status: 'error' as const, error: result?.error || '测速失败' }
          };
          saveBenchmarkResults(updated);
          return updated;
        });
      }
    } catch (err: any) {
      setBenchmarkResults(prev => {
        const updated = {
          ...prev,
          [fullId]: { status: 'error' as const, error: err.message }
        };
        saveBenchmarkResults(updated);
        return updated;
      });
    }
  };

  // 测速所有模型
  const benchmarkAllModels = async () => {
    const activeKey = savedKeys.find(k => k.id === activeKeyId);
    if (!activeKey || benchmarking) return;
    
    const models = filterModels(activeKey.models);
    if (models.length === 0) return;
    
    setBenchmarking(true);
    setBenchmarkProgress({ done: 0, total: models.length });
    
    const provider = activeKey.provider;
    let allResults = { ...benchmarkResults };
    
    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const fullId = `${provider}/${model.id}`;
      
      setBenchmarkResults(prev => ({
        ...prev,
        [fullId]: { status: 'pending' }
      }));
      
      try {
        const result = await electronAPI?.api.benchmarkModel(provider, activeKey.apiKey, model.id);
        if (result?.success) {
          allResults[fullId] = {
            status: 'ok',
            tps: result.tps,
            latencyMs: result.latencyMs,
            outputTokens: result.outputTokens
          };
          setBenchmarkResults(prev => ({
            ...prev,
            [fullId]: allResults[fullId]
          }));
        } else {
          allResults[fullId] = { status: 'error', error: result?.error || '测速失败' };
          setBenchmarkResults(prev => ({
            ...prev,
            [fullId]: allResults[fullId]
          }));
        }
      } catch (err: any) {
        allResults[fullId] = { status: 'error', error: err.message };
        setBenchmarkResults(prev => ({
          ...prev,
          [fullId]: allResults[fullId]
        }));
      }
      
      setBenchmarkProgress({ done: i + 1, total: models.length });
    }
    
    // 测速完成后保存所有结果
    saveBenchmarkResults(allResults);
    
    setBenchmarking(false);
    setBenchmarkProgress(null);
  };

  // 排序模型
  const sortModels = (models: Model[]) => {
    if (sortMode === 'none') return models;
    
    const provider = getActiveProvider();
    return [...models].sort((a, b) => {
      const fullIdA = `${provider}/${a.id}`;
      const fullIdB = `${provider}/${b.id}`;
      const resultA = benchmarkResults[fullIdA];
      const resultB = benchmarkResults[fullIdB];
      
      // 没有测速结果的排在后面
      if (!resultA || resultA.status !== 'ok') return 1;
      if (!resultB || resultB.status !== 'ok') return -1;
      
      let valueA: number, valueB: number;
      if (sortMode === 'tps') {
        valueA = resultA.tps || 0;
        valueB = resultB.tps || 0;
      } else {
        valueA = resultA.latencyMs || Infinity;
        valueB = resultB.latencyMs || Infinity;
      }
      
      // tps: desc = 高到低; latency: asc = 低到高
      if (sortMode === 'tps') {
        return sortDirection === 'desc' ? valueB - valueA : valueA - valueB;
      } else {
        return sortDirection === 'asc' ? valueA - valueB : valueB - valueA;
      }
    });
  };

  // 切换排序
  const toggleSort = (mode: 'tps' | 'latency') => {
    let newMode: 'none' | 'tps' | 'latency' = mode;
    let newDirection: 'asc' | 'desc' = mode === 'tps' ? 'desc' : 'asc';
    
    if (sortMode === mode) {
      // 同一模式，切换方向或关闭
      if (sortDirection === 'desc') {
        newDirection = 'asc';
      } else {
        newMode = 'none';
      }
    }
    
    setSortMode(newMode);
    setSortDirection(newDirection);
    localStorage.setItem('Drivemolt_sort_mode', newMode);
    localStorage.setItem('Drivemolt_sort_direction', newDirection);
  };

  return (
    <div className="page models-page">
      <div className="page-header">
        <h2><Cpu size={24} /> 模型管理</h2>
        <button className="btn-icon" onClick={loadCurrentModel} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>

      {/* 当前模型 */}
      <div className="current-model card">
        <div className="current-info">
          <div className="current-label">当前使用模型</div>
          <div className="current-value">
            {loading ? <RefreshCw size={16} className="spin" /> : (currentModel || '未配置')}
          </div>
        </div>
      </div>

      {/* API Key 管理 */}
      <div className="api-config card">
        <div className="api-header">
          <h3><Key size={18} /> API Keys</h3>
          <button 
            className="btn-small"
            onClick={() => setShowAddKey(!showAddKey)}
          >
            <Plus size={14} />
            添加
          </button>
        </div>

        {/* 已保存的 API Keys 列表 */}
        {savedKeys.length > 0 && (
          <div className="saved-keys-list">
            {savedKeys.map(key => (
              <div 
                key={key.id} 
                className={`saved-key-item ${activeKeyId === key.id ? 'active' : ''}`}
              >
                <div 
                  className="key-info"
                  onClick={() => activateKey(key.id)}
                >
                  <span className="key-name">{key.name}</span>
                  <span className="key-provider">{key.provider}</span>
                  <span className="key-models">{key.models.length} 模型</span>
                </div>
                <div className="key-actions">
                  {activeKeyId === key.id && (
                    <span className="active-indicator">
                      <Check size={14} /> 使用中
                    </span>
                  )}
                  <button 
                    className="btn-icon-small danger"
                    onClick={(e) => { e.stopPropagation(); deleteKey(key.id); }}
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 添加新 API Key */}
        {(showAddKey || savedKeys.length === 0) && (
          <div className="add-key-form">
            <div className="form-row">
              <select 
                value={selectedProvider} 
                onChange={e => setSelectedProvider(e.target.value)}
              >
                {providers.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                placeholder="名称 (可选)"
                className="key-name-input"
              />
            </div>
            <div className="form-row">
              <input
                type="password"
                value={newApiKey}
                onChange={e => setNewApiKey(e.target.value)}
                placeholder="输入 API Key..."
                className="key-input"
              />
              <button 
                className="btn-primary"
                onClick={detectModels}
                disabled={detecting || !newApiKey.trim()}
              >
                {detecting ? <RefreshCw size={14} className="spin" /> : <Plus size={14} />}
                添加
              </button>
            </div>
            {error && (
              <div className="api-error">
                <AlertCircle size={14} /> {error}
              </div>
            )}
          </div>
        )}

        {savedKeys.length === 0 && !showAddKey && (
          <div className="api-hint">
            添加 API Key 来开始使用
          </div>
        )}
      </div>

      {/* 搜索框和测速按钮 */}
      <div className="search-row">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="搜索模型..."
          />
        </div>
        {activeKeyId && (
          <>
            <button 
              className="btn-benchmark"
              onClick={() => {
                setBenchmarkInterrupted(false);
                benchmarkAllModels();
              }}
              disabled={benchmarking || !getActiveKeyModels().length}
              title="测速所有模型"
            >
              {benchmarking ? (
                <><RefreshCw size={14} className="spin" /> 测速中 ({benchmarkProgress?.done}/{benchmarkProgress?.total})</>
              ) : benchmarkInterrupted && benchmarkProgress ? (
                <><AlertCircle size={14} /> 已中断 ({benchmarkProgress.done}/{benchmarkProgress.total}) - 点击重新测速</>
              ) : (
                <><Timer size={14} /> 测速全部</>
              )}
            </button>
            <div className="sort-buttons">
              <button
                className={`btn-sort ${sortMode === 'tps' ? 'active' : ''}`}
                onClick={() => toggleSort('tps')}
                title="按速度排序"
              >
                {sortMode === 'tps' ? (
                  sortDirection === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />
                ) : <ArrowUpDown size={14} />}
                速度
              </button>
              <button
                className={`btn-sort ${sortMode === 'latency' ? 'active' : ''}`}
                onClick={() => toggleSort('latency')}
                title="按延迟排序"
              >
                {sortMode === 'latency' ? (
                  sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />
                ) : <ArrowUpDown size={14} />}
                延迟
              </button>
            </div>
          </>
        )}
      </div>

      {/* 模型列表 - 显示当前激活 Key 的模型 */}
      {activeKeyId && (
        <div className="models-list">
          <div className="provider-section">
            <div 
              className="provider-header configured"
              onClick={() => {
                const provider = getActiveProvider();
                if (provider) toggleProvider(provider);
              }}
            >
              {expandedProviders.includes(getActiveProvider() || '') ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              <span className="provider-name">
                {providers.find(p => p.id === getActiveProvider())?.name || getActiveProvider()}
              </span>
              <span className="model-count">
                {filterModels(getActiveKeyModels()).length} 个模型
              </span>
              <Check size={14} className="check-icon" />
            </div>
            
            {expandedProviders.includes(getActiveProvider() || '') && (
              <div className="models-grid">
                {sortModels(filterModels(getActiveKeyModels())).length === 0 ? (
                  <div className="no-models">没有匹配的模型</div>
                ) : (
                  sortModels(filterModels(getActiveKeyModels())).map((model, index) => {
                    const provider = getActiveProvider();
                    const fullId = `${provider}/${model.id}`;
                    const isActive = currentModel === fullId;
                    const isFavorite = favorites.includes(fullId);
                    
                    return (
                      <div 
                        key={`${model.id}-${index}`}
                        className={`model-card ${isActive ? 'active' : ''}`}
                        onClick={() => provider && switchModel(provider, model.id, activeKeyId)}
                      >
                        <div className="model-header">
                          <span className="model-name">{model.name || model.id}</span>
                          <button 
                            className={`star-btn ${isFavorite ? 'starred' : ''}`}
                            onClick={(e) => { e.stopPropagation(); toggleFavorite(fullId); }}
                          >
                            <Star size={14} fill={isFavorite ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        <div className="model-id">{model.id}</div>
                        {model.owned_by && (
                          <div className="model-owner">
                            <Zap size={10} /> {model.owned_by}
                          </div>
                        )}
                        {/* 测速结果和按钮 */}
                        <div className="benchmark-row">
                          {benchmarkResults[fullId] ? (
                            <div className={`benchmark-result ${benchmarkResults[fullId].status}`}>
                              {benchmarkResults[fullId].status === 'pending' && (
                                <><RefreshCw size={10} className="spin" /> 测速中...</>
                              )}
                              {benchmarkResults[fullId].status === 'ok' && (
                                <><Timer size={10} /> {benchmarkResults[fullId].tps} tok/s | {benchmarkResults[fullId].latencyMs}ms</>
                              )}
                              {benchmarkResults[fullId].status === 'error' && (
                                <><AlertCircle size={10} /> 失败</>
                              )}
                            </div>
                          ) : (
                            <div className="benchmark-result empty">未测速</div>
                          )}
                          {!benchmarking && benchmarkResults[fullId]?.status !== 'pending' && (
                            <button
                              className="btn-benchmark-single"
                              onClick={(e) => { e.stopPropagation(); benchmarkSingleModel(model.id); }}
                              title={benchmarkResults[fullId] ? '重新测速' : '测速此模型'}
                            >
                              <Play size={10} />
                            </button>
                          )}
                        </div>
                        {isActive && (
                          <span className="active-badge">
                            <Check size={12} /> 使用中
                          </span>
                        )}
                        {switching === fullId && (
                          <div className="switching-overlay">
                            <RefreshCw size={18} className="spin" />
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {!activeKeyId && (
        <div className="no-key-hint card">
          <AlertCircle size={20} />
          <p>请先添加 API Key 来查看可用模型</p>
        </div>
      )}

      {/* 提示 */}
      <div className="card model-tips">
        <h3>💡 使用说明</h3>
        <ul>
          <li>输入 API Key 后点击"检测模型"自动获取可用模型</li>
          <li>点击模型卡片切换，同时会设置对应的 API Key</li>
          <li>点击★收藏常用模型</li>
          <li>切换模型后需重启 Gateway 生效</li>
        </ul>
      </div>
    </div>
  );
}
