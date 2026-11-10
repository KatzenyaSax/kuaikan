package top.katzenyasax.kuaikan.user.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.UUID;

/**
 * JWT 的签发与解析。
 *
 * 用 JWT 承载 refresh token 而不是不透明随机串：**数据库里只存 jti**，
 * 即使库被拖走也伪造不出签名覆盖的 token。不透明串则等价于把凭证本身存进库。
 *
 * 两种 token 用 typ 区分，防止「拿 refresh 当 access 用」这种越权。
 */
@Service
public class TokenService {

    private static final Logger log = LoggerFactory.getLogger(TokenService.class);

    public static final Duration ACCESS_TTL = Duration.ofHours(2);
    public static final Duration REFRESH_TTL = Duration.ofDays(30);
    private static final String ISSUER = "kuaikan";

    private final RsaKeyProvider keyProvider;
    private final RSASSASigner signer;

    public TokenService(RsaKeyProvider keyProvider) {
        this.keyProvider = keyProvider;
        try {
            this.signer = new RSASSASigner(keyProvider.signingKey());
        } catch (JOSEException e) {
            // 密钥不可用属于启动期致命错误，直接失败而不是降级成"发不出 token"
            throw new IllegalStateException("RSA 签名器初始化失败", e);
        }
    }

    public record IssuedToken(String value, String jti, Instant expiresAt) {
    }

    /** access token：sub=userId、jti、roles、typ=access */
    public IssuedToken issueAccess(Long userId, String roles) {
        String jti = UUID.randomUUID().toString();
        Instant now = Instant.now();
        Instant exp = now.plus(ACCESS_TTL);
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(String.valueOf(userId))
                .issuer(ISSUER)
                .jwtID(jti)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(exp))
                .claim("typ", "access")
                .claim("roles", roles)
                .build();
        return new IssuedToken(sign(claims), jti, exp);
    }

    /** refresh token：sub=userId、jti、fid=家族 id、typ=refresh */
    public IssuedToken issueRefresh(Long userId, String familyId) {
        String jti = UUID.randomUUID().toString();
        Instant now = Instant.now();
        Instant exp = now.plus(REFRESH_TTL);
        JWTClaimsSet claims = new JWTClaimsSet.Builder()
                .subject(String.valueOf(userId))
                .issuer(ISSUER)
                .jwtID(jti)
                .issueTime(Date.from(now))
                .expirationTime(Date.from(exp))
                .claim("typ", "refresh")
                .claim("fid", familyId)
                .build();
        return new IssuedToken(sign(claims), jti, exp);
    }

    public String newFamilyId() {
        return UUID.randomUUID().toString();
    }

    private String sign(JWTClaimsSet claims) {
        try {
            JWSHeader header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                    .keyID(keyProvider.signingKey().getKeyID())
                    .type(com.nimbusds.jose.JOSEObjectType.JWT)
                    .build();
            SignedJWT jwt = new SignedJWT(header, claims);
            jwt.sign(signer);
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException("JWT 签发失败", e);
        }
    }

    /**
     * 验签并解析。
     *
     * @param expectedType access 或 refresh —— 强制校验，防止把 refresh 当 access 用
     */
    public JWTClaimsSet verify(String token, String expectedType) {
        try {
            SignedJWT jwt = SignedJWT.parse(token);
            if (!jwt.verify(new RSASSAVerifier(keyProvider.publicKey()))) {
                throw new IllegalArgumentException("签名校验失败");
            }
            JWTClaimsSet claims = jwt.getJWTClaimsSet();
            Date exp = claims.getExpirationTime();
            if (exp == null || exp.toInstant().isBefore(Instant.now())) {
                throw new IllegalArgumentException("token 已过期");
            }
            if (!ISSUER.equals(claims.getIssuer())) {
                throw new IllegalArgumentException("issuer 不匹配");
            }
            Object typ = claims.getClaim("typ");
            if (!expectedType.equals(typ)) {
                throw new IllegalArgumentException("token 类型不符，期望 " + expectedType);
            }
            return claims;
        } catch (Exception e) {
            log.debug("token 校验失败：{}", e.getMessage());
            throw new IllegalArgumentException("凭证无效");
        }
    }

    public Long subjectOf(JWTClaimsSet claims) {
        return Long.valueOf(claims.getSubject());
    }
}
