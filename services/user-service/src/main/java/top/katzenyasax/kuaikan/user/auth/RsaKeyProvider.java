package top.katzenyasax.kuaikan.user.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.jwk.RSAKey;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.KeyFactory;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPrivateKey;
import java.security.interfaces.RSAPublicKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;

/**
 * RSA 密钥对的加载与首次生成。
 *
 * 为什么落盘而不是每次启动随机生成：**随机生成会让所有已签发的 token 在重启后全部失效**，
 * 表现为"服务重启后所有人都要重新登录"。落盘后 kid 稳定，网关的 JWKS 缓存也不会被冲掉。
 *
 * kid 用密钥指纹（thumbprint）而不是自增序号：轮换密钥时旧 token 仍能按 kid 找到对应公钥。
 */
@Component
public class RsaKeyProvider {

    private static final Logger log = LoggerFactory.getLogger(RsaKeyProvider.class);
    private static final String PRIVATE_FILE = "jwt-private.pem";
    private static final String PUBLIC_FILE = "jwt-public.pem";

    private final RSAKey rsaKey;

    public RsaKeyProvider(@Value("${kuaikan.auth.key-dir:/app/keys}") String keyDir) {
        this.rsaKey = loadOrGenerate(Path.of(keyDir));
    }

    /** 含私钥，用于签发。**不要外传** */
    public RSAKey signingKey() {
        return rsaKey;
    }

    /** 只含公钥，用于 JWKS 与下游验签 */
    public RSAKey publicKey() {
        return rsaKey.toPublicJWK();
    }

    public String jwksJson() {
        return "{\"keys\":[" + publicKey().toJSONString() + "]}";
    }

    private RSAKey loadOrGenerate(Path dir) {
        try {
            Files.createDirectories(dir);
            Path priv = dir.resolve(PRIVATE_FILE);
            Path pub = dir.resolve(PUBLIC_FILE);

            if (Files.exists(priv) && Files.exists(pub)) {
                RSAKey key = readKeyPair(priv, pub);
                log.info("已加载 RSA 密钥 dir={} kid={}", dir, key.getKeyID());
                return key;
            }

            log.warn("未找到 RSA 密钥，正在生成 2048 位密钥对 dir={}（仅首次启动会执行）", dir);
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            KeyPair pair = generator.generateKeyPair();

            writePem(priv, "PRIVATE KEY", pair.getPrivate().getEncoded());
            writePem(pub, "PUBLIC KEY", pair.getPublic().getEncoded());

            RSAKey key = new RSAKey.Builder((RSAPublicKey) pair.getPublic())
                    .privateKey((RSAPrivateKey) pair.getPrivate())
                    .keyIDFromThumbprint()
                    .build();
            log.info("RSA 密钥对已生成 kid={}", key.getKeyID());
            return key;
        } catch (Exception e) {
            throw new IllegalStateException("无法准备 RSA 密钥，dir=" + dir, e);
        }
    }

    private RSAKey readKeyPair(Path priv, Path pub) throws Exception {
        String privPem = Files.readString(priv, StandardCharsets.US_ASCII);
        String pubPem = Files.readString(pub, StandardCharsets.US_ASCII);

        KeyFactory factory = KeyFactory.getInstance("RSA");
        RSAPrivateKey privateKey = (RSAPrivateKey) factory.generatePrivate(
                new PKCS8EncodedKeySpec(decodePem(privPem)));
        RSAPublicKey publicKey = (RSAPublicKey) factory.generatePublic(
                new X509EncodedKeySpec(decodePem(pubPem)));

        return new RSAKey.Builder(publicKey)
                .privateKey(privateKey)
                .keyIDFromThumbprint()
                .build();
    }

    private void writePem(Path path, String type, byte[] der) throws IOException, JOSEException {
        String base64 = Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.US_ASCII))
                .encodeToString(der);
        String pem = "-----BEGIN " + type + "-----\n" + base64 + "\n-----END " + type + "-----\n";
        Files.writeString(path, pem, StandardCharsets.US_ASCII);
        try {
            Files.setPosixFilePermissions(path, PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException ignored) {
            // 非 POSIX 文件系统，忽略
        }
    }

    private byte[] decodePem(String pem) {
        String base64 = pem
                .replace("-----BEGIN PRIVATE KEY-----", "")
                .replace("-----END PRIVATE KEY-----", "")
                .replace("-----BEGIN PUBLIC KEY-----", "")
                .replace("-----END PUBLIC KEY-----", "")
                .replaceAll("\\s", "");
        return Base64.getDecoder().decode(base64);
    }
}
