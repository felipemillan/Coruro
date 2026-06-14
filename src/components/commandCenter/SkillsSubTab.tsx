// SkillsSubTab.tsx — Skills sub-tab for the Command Center.

import type { ClaudeSkill } from '../../types';
import { FilterBar } from '../claude/FilterBar';
import type { FilterGroup } from '../claude/FilterBar';
import { SkillCard } from '../claude/InventoryCards';
import type { ClaudeDetailEntity } from '../claude/ClaudeDetail';

interface SkillsSubTabProps {
  filteredSkills: ClaudeSkill[];
  skillSources: string[];
  skillSearch: string;
  onSkillSearch: (v: string) => void;
  skillSource: string;
  onSkillSource: (v: string) => void;
  onOpenDetail: (entity: ClaudeDetailEntity) => void;
}

export function SkillsSubTab({
  filteredSkills,
  skillSources,
  skillSearch,
  onSkillSearch,
  skillSource,
  onSkillSource,
  onOpenDetail,
}: SkillsSubTabProps) {
  return (
    <>
      <FilterBar
        search={skillSearch}
        onSearch={onSkillSearch}
        placeholder="Search skills…"
        filters={[
          {
            key: 'source',
            label: 'Source',
            options: skillSources,
            value: skillSource,
            onChange: onSkillSource,
          } satisfies FilterGroup,
        ]}
      />
      {filteredSkills.length === 0 ? (
        <p className="text-sm text-navy-light text-center py-8">No skills match.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredSkills.map((skill, i) => (
            <SkillCard
              key={`${skill.path}-${i}`}
              skill={skill}
              onOpen={() =>
                onOpenDetail({
                  kind: 'skill',
                  name: skill.name,
                  path: skill.path,
                  description: skill.description,
                  source: skill.source,
                })
              }
            />
          ))}
        </div>
      )}
    </>
  );
}
