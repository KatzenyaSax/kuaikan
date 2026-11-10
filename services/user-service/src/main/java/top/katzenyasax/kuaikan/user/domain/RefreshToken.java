package top.katzenyasax.kuaikan.user.domain;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

import java.time.LocalDateTime;

@TableName("t_refresh_token")
public class RefreshToken {

    @TableId(type = IdType.ASSIGN_ID)
    private Long id;

    private Long userId;
    private String jti;
    private String familyId;
    private LocalDateTime issuedAt;
    private LocalDateTime expiresAt;

    /** 首次用于轮换的时刻；宽限期从此刻起算。为空表示尚未使用 */
    private LocalDateTime consumedAt;

    private LocalDateTime revokedAt;
    private String replacedByJti;
    private LocalDateTime lastUsedAt;
    private String userAgent;
    private String ip;

    /*
     * 刻意没有 createdAt：issuedAt 已经是这条记录的语义时间戳，
     * 再加一个 created_at 是同一信息的重复存储，且两者一旦不一致没人说得清哪个对。
     * （t_user 有 created_at 是因为它的业务时间戳不叫 issued_at。）
     */

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public String getJti() { return jti; }
    public void setJti(String jti) { this.jti = jti; }

    public String getFamilyId() { return familyId; }
    public void setFamilyId(String familyId) { this.familyId = familyId; }

    public LocalDateTime getIssuedAt() { return issuedAt; }
    public void setIssuedAt(LocalDateTime issuedAt) { this.issuedAt = issuedAt; }

    public LocalDateTime getExpiresAt() { return expiresAt; }
    public void setExpiresAt(LocalDateTime expiresAt) { this.expiresAt = expiresAt; }

    public LocalDateTime getConsumedAt() { return consumedAt; }
    public void setConsumedAt(LocalDateTime consumedAt) { this.consumedAt = consumedAt; }

    public LocalDateTime getRevokedAt() { return revokedAt; }
    public void setRevokedAt(LocalDateTime revokedAt) { this.revokedAt = revokedAt; }

    public String getReplacedByJti() { return replacedByJti; }
    public void setReplacedByJti(String replacedByJti) { this.replacedByJti = replacedByJti; }

    public LocalDateTime getLastUsedAt() { return lastUsedAt; }
    public void setLastUsedAt(LocalDateTime lastUsedAt) { this.lastUsedAt = lastUsedAt; }

    public String getUserAgent() { return userAgent; }
    public void setUserAgent(String userAgent) { this.userAgent = userAgent; }

    public String getIp() { return ip; }
    public void setIp(String ip) { this.ip = ip; }
}
