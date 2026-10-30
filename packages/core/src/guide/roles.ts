import type { Role, RoleRule } from "../config.js";
import type { ClassSymbol } from "../index/symbols.js";

interface BuiltIn {
  role: Role;
  annotations: string[];
  suffixes: string[];
  supertypes?: string[];
}

/** 설계 7단계 5.1 표. 위에서부터 먼저 맞는 것 하나만 쓴다 */
const BUILT_IN: BuiltIn[] = [
  { role: "entry", annotations: ["RestController", "Controller"], suffixes: ["Controller", "Listener", "Consumer", "Handler", "Job"] },
  { role: "service", annotations: ["Service"], suffixes: ["Service", "UseCase", "Facade"] },
  { role: "integration", annotations: ["FeignClient", "HttpExchange"], suffixes: ["Client", "Gateway", "Adapter"] },
  {
    role: "data", annotations: ["Repository", "Mapper"], suffixes: ["Repository", "Dao", "Mapper"],
    supertypes: ["JpaRepository", "CrudRepository", "PagingAndSortingRepository", "ListCrudRepository", "R2dbcRepository", "MongoRepository"],
  },
  { role: "model", annotations: ["Entity", "Embeddable", "Document", "MappedSuperclass"], suffixes: ["Dto", "Request", "Response", "Vo", "Event"] },
  { role: "config", annotations: ["Configuration", "ConfigurationProperties", "AutoConfiguration"], suffixes: ["Config", "Configuration", "Properties"] },
];

/**
 * 클래스의 역할. 사용자 규칙(.callpath.yml roles) → 애노테이션과 구조 → 이름 끝과 상위 타입 순으로 본다.
 * hasEntry는 진입점 메서드가 있는 클래스인지다(메시지 리스너, @Scheduled, gRPC 구현, main).
 */
export function roleOf(cls: Pick<ClassSymbol, "name" | "kind" | "annotations" | "supertypes">, hasEntry: boolean, rules: RoleRule[] = []): Role {
  const annotations = new Set(cls.annotations.map((a) => a.name));
  // OrderServiceImpl, PaymentClientImpl처럼 구현 표시를 떼고 이름 끝을 본다
  const name = cls.name.replace(/Impl$/, "");

  for (const r of rules) {
    if (r.annotation && annotations.has(r.annotation)) return r.role;
    if (r.suffix && name.endsWith(r.suffix)) return r.role;
  }
  for (const b of BUILT_IN) {
    if (b.annotations.some((a) => annotations.has(a))) return b.role;
    if (b.role === "entry" && hasEntry) return "entry";
  }
  // @ConfigurationProperties record처럼 애노테이션이 있으면 그쪽을 먼저 따른다
  if (cls.kind === "record" || cls.kind === "data" || cls.kind === "enum") return "model";
  for (const b of BUILT_IN) {
    if (b.suffixes.some((s) => name.endsWith(s) && name !== s)) return b.role;
    if (b.supertypes?.some((s) => cls.supertypes.includes(s))) return b.role;
  }
  return "other";
}
