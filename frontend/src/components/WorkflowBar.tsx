import { useQuery } from '@tanstack/react-query';
import { CheckOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { getOverview } from '../api/ssl';
import {
  WORKFLOW_STEPS,
  isStepComplete,
  workflowStepFromPath,
  type WorkflowProgress,
} from './workflow';

interface WorkflowBarProps {
  current?: (typeof WORKFLOW_STEPS)[number]['key'];
}

export function useWorkflowProgress(): WorkflowProgress | undefined {
  const overview = useQuery({ queryKey: ['overview'], queryFn: getOverview });
  if (!overview.data) {
    return undefined;
  }
  return {
    caReady: overview.data.cas.ready,
    certificateCount: overview.data.certificateCount,
    serverCount: overview.data.serverCount,
  };
}

export function WorkflowBar({ current }: WorkflowBarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const progress = useWorkflowProgress();
  const active = current ?? workflowStepFromPath(location.pathname);

  return (
    <nav className="workflow-bar" aria-label="配置流程">
      {WORKFLOW_STEPS.map((step, index) => {
        const complete = isStepComplete(step.key, progress);
        const isCurrent = step.key === active;
        const classNames = [
          'workflow-step',
          isCurrent ? 'is-current' : '',
          complete ? 'is-complete' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={step.key}
            type="button"
            className={classNames}
            onClick={() => navigate(step.path)}
          >
            <span className="workflow-step-index" aria-hidden>
              {complete && !isCurrent ? <CheckOutlined /> : step.index}
            </span>
            <span className="workflow-step-body">
              <span className="workflow-step-title">{step.title}</span>
              <span className="workflow-step-short">{step.short}</span>
            </span>
            {index < WORKFLOW_STEPS.length - 1 ? <span className="workflow-step-rail" /> : null}
          </button>
        );
      })}
    </nav>
  );
}
